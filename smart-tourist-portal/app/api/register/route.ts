import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { kyc, itinerary, emergencyContacts, tripDurationDays, health } = body;

    if (!kyc || !itinerary || !emergencyContacts || !tripDurationDays) {
      return NextResponse.json(
        { message: "missing required fields" },
        { status: 400 }
      );
    }

    // Forward the registration request to our backend server
    const backendResponse = await fetch(`${(process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/tourists/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kyc,
        itinerary,
        emergencyContacts,
        tripDurationDays,
        health
      }),
    });

    const backendData = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json(
        { message: backendData.message || "Registration failed" },
        { status: backendResponse.status }
      );
    }

    return NextResponse.json(
      {
        message: "Tourist registered successfully",
        digitalId: backendData.digitalId,
        dbId: backendData.dbId,
        healthPermit: backendData.healthPermit,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration failed:", error);
    return NextResponse.json(
      {
        message: "Internal server error",
      },
      { status: 500 }
    );
  }
}
