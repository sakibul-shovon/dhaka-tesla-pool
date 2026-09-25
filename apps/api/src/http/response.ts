import type { Response } from "express";

export function sendData<T>(res: Response, status: number, data: T): void {
  res.status(status).json({ data });
}
