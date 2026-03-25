import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/voltix_ai';

let connectionPromise: Promise<typeof mongoose> | null = null;

export const connectMongo = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(MONGO_URI);
  }

  return connectionPromise;
};
