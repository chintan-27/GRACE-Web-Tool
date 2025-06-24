"use client";
import crypto from "crypto";
import { io, Socket } from "socket.io-client";
import { encode } from "next-auth/jwt";


const server = process.env.server || "https://flask.thecka.tech";

const SOCKET_URL = server;
const secret1 = process.env.NEXT_PUBLIC_API_SECRET || "default_secret";
const secret2 = process.env.NEXT_JWT_SECRET || "default_secret";

export const createSocket = async (): Promise<Socket> => {
  const ts = (Date.now() + 15 * 60 * 1000).toString()
  const signature = crypto.createHmac("sha256", secret1).update(ts).digest("hex");
  // 3) Build & sign the JWT
  const token = await encode({
    token: { ts, signature },
    secret: secret2,
    maxAge: 15 * 60, // 15 minutes
  });

  return io(SOCKET_URL, {
    autoConnect: false, // Important: connect manually later
    query: {
      token
    },
  });
};