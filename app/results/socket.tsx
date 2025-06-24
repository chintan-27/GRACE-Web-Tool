// socket.js
import crypto from "crypto";
import { io, Socket } from "socket.io-client";
import jwt from "jsonwebtoken";

const server = process.env.server || "http://localhost:5500";

const SOCKET_URL = server;
const secret1 = process.env.NEXT_PUBLIC_API_SECRET || "default_secret";
const secret2 = process.env.NEXT_JWT_SECRET || "default_secret";

export const createSocket = (): Socket => {
  const ts = (Date.now() + 15 * 60 * 1000).toString()
  const signature = crypto.createHmac("sha256", secret1).update(ts).digest("hex");
  const token = jwt.sign({ ts, signature }, secret2, { algorithm: 'HS256', expiresIn: '15m' });

  return io(SOCKET_URL, {
    autoConnect: false, // Important: connect manually later
    query: {
      token
    },
  });
};