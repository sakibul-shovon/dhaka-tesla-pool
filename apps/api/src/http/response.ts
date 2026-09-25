import type { Response } from "express";

export function sendData<T>(res: Response, status: number, data: T): void {
  res.status(status).json({ data });
}

export function sendPage<T>(res: Response, data: readonly T[], page: { limit: number; nextCursor: string | null }): void {
  res.status(200).json({ data, page });
}
