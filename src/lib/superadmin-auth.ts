export function checkSuperadminSecret(request: Request): Response | null {
  const secret = process.env.SUPERADMIN_SECRET;
  if (!secret) {
    return Response.json({ error: "Superadmin not configured." }, { status: 503 });
  }

  const provided = request.headers.get("x-superadmin-secret");
  if (!provided || provided !== secret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
