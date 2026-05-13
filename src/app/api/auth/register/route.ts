import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Account registration is not available. Please contact your administrator." },
    { status: 403 }
  );
}
