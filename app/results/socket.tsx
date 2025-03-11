// socket.js
import { io } from "socket.io-client";

const SOCKET_URL = "http://localhost:5500";

const socket = io(SOCKET_URL, {
  autoConnect: true,
});

export default socket;