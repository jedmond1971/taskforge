import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export function requireV1ApiKey(request: Request): Response | null {
  const apiKey = process.env.V1_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "V1_API_KEY environment variable is not configured" },
      { status: 500 }
    );
  }

  const incomingKey = request.headers.get("X-Internal-Api-Key");
  if (!incomingKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keyBuf = Buffer.from(apiKey);
  const incomingBuf = Buffer.from(incomingKey);

  if (keyBuf.length !== incomingBuf.length) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!timingSafeEqual(keyBuf, incomingBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
