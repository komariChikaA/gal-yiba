import { io, type Socket } from "socket.io-client";
import { API_BASE, STATIC_PLAY, apiUrl } from "./config";
import { StaticPlayRuntime, type Ack } from "./static-play";

type Handler = (...args: any[]) => void;

const staticRuntime = STATIC_PLAY ? new StaticPlayRuntime() : null;
const socket: Socket | null = STATIC_PLAY
  ? null
  : io(API_BASE || undefined, { autoConnect: true });

export const isStaticPlay = STATIC_PLAY;

export function backendFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (staticRuntime) return staticRuntime.handleFetch(path, init);
  return fetch(apiUrl(path), init);
}

export function emit(event: string, payload: unknown, ack?: Ack): void {
  if (staticRuntime) {
    staticRuntime.handleEmit(event, payload, ack);
    return;
  }
  socket!.emit(event, payload, ack);
}

export function on(event: string, handler: Handler): void {
  if (staticRuntime) {
    staticRuntime.on(event, handler);
    return;
  }
  socket!.on(event, handler as never);
}

export function off(event: string, handler: Handler): void {
  if (staticRuntime) {
    staticRuntime.off(event, handler);
    return;
  }
  socket!.off(event, handler as never);
}

export function isConnected(): boolean {
  return staticRuntime ? true : Boolean(socket?.connected);
}

export function audioSrc(audioId: string): string {
  if (staticRuntime) return staticRuntime.audioSrc(audioId);
  return apiUrl(`/api/chat-audio/${audioId}`);
}
