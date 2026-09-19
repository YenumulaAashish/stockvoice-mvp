import { z } from 'zod';
export const units = ['piece', 'kg', 'litre', 'bag', 'dozen'];
export const intents = ['ADD_STOCK', 'REMOVE_STOCK', 'CHECK_STOCK', 'LOW_STOCK', 'UNKNOWN'];
export const number = z.number().finite().min(0).max(1000000).refine(v => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.000001, 'Use at most 3 decimal places');
export const productSchema = z.object({ name: z.string().trim().min(1).max(80), unit: z.enum(units), quantity: number, price: number, lowStockThreshold: number }).strict();
export const commandSchema = z.object({ intent: z.enum(intents), product: z.string().trim().min(1).max(80).nullable(), quantity: number.nullable(), unit: z.enum(units).nullable(), price: number.nullable(), needsClarification: z.boolean() }).strict();
export const transcriptSchema = z.string().trim().min(1).max(1000);
export function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
export const key = name => name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export const round = value => Math.round(value * 1000) / 1000;
export function validateProduct(product) {
  productSchema.parse(product);
  if (['piece', 'bag', 'dozen'].includes(product.unit) && (!Number.isInteger(product.quantity) || !Number.isInteger(product.lowStockThreshold))) fail('Piece, bag, and dozen quantities and thresholds must be whole numbers.');
}
export function resolveCommand(raw, products) {
  const command = commandSchema.parse(raw);
  if (command.intent === 'UNKNOWN') fail('I could not understand that inventory command. Please try again.');
  if (['ADD_STOCK', 'REMOVE_STOCK'].includes(command.intent)) {
    if (command.quantity === null) fail('Quantity is missing. Please say the command again.');
    if (!command.unit) fail('Unit is missing. Please say the command again.');
  }
  if (command.needsClarification) fail('I could not understand that. Please try again.');
  if (command.intent === 'LOW_STOCK') return { command, products: products.filter(p => p.quantity <= p.lowStockThreshold) };
  if (!command.product) fail('Which product do you mean?');
  const matches = products.filter(p => key(p.name) === key(command.product));
  if (matches.length !== 1) fail(`Product “${command.product}” was not found. Add it using New product, or use its exact inventory name.`);
  const product = matches[0];
  if (command.intent === 'CHECK_STOCK') return { command, products: [product] };
  if (command.quantity === null || command.quantity <= 0) fail('Enter a quantity greater than zero.');
  if (!command.unit) fail('Include the unit, for example kg or piece.');
  if (command.unit !== product.unit) fail(`${product.name} is tracked in ${product.unit}. Unit conversions are not supported.`);
  if (['piece', 'bag', 'dozen'].includes(command.unit) && !Number.isInteger(command.quantity)) fail('Use a whole number for piece, bag, and dozen.');
  if (command.intent === 'REMOVE_STOCK' && command.price !== null) fail('To change the unit price, edit the product separately.');
  const after = round(product.quantity + (command.intent === 'ADD_STOCK' ? command.quantity : -command.quantity));
  if (after < 0) fail(`Unable to remove ${command.quantity} ${product.unit} of ${product.name}. Only ${product.quantity} ${product.unit} are available.`);
  if (after > 1000000) fail('Resulting stock exceeds the maximum of 1,000,000.');
  return { command, product, after };
}
