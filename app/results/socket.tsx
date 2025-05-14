// socket.js
import crypto from "crypto";
import { io, Socket } from "socket.io-client";

const server = process.env.server || "http://localhost:5500";

const SOCKET_URL = server;
const secret = process.env.NEXT_PUBLIC_API_SECRET || "default_secret";

export const createSocket = (): Socket => {
  const ts = Date.now().toString();
  const signature = crypto.createHmac("sha256", secret).update(ts).digest("hex");

  return io(SOCKET_URL, {
    autoConnect: false, // Important: connect manually later
    query: {
      ts,
      signature,
    },
  });
};