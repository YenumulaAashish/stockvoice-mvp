// Explicit local administration only: never assign unowned records during signup.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv[3] !== '--confirm') throw new Error('Usage: node server/assign-legacy.js account@example.com --confirm');
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'stockvoice');
  const user = await db.collection('users').findOne({ email });
  if (!user) throw new Error('Create the target account first.');
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const collection of ['products', 'events']) await db.collection(collection).updateMany({ ownerId: { $exists: false } }, { $set: { ownerId: user.id } }, { session });
    });
    console.log('Unowned legacy products and history assigned to the selected account. Old confirmations were not transferred.');
  } finally { await session.endSession(); }
} catch (error) { console.error(error.code === 11000 ? 'Assignment stopped: a product name already exists in this account. No records were transferred.' : 'Assignment failed. Check the target account and database connection.'); process.exitCode = 1; }
finally { await client.close(); }
