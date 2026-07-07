-- Add invitedById (required) and acceptedAt (optional) to OrgInvite
ALTER TABLE "OrgInvite" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "OrgInvite" ADD COLUMN "invitedById" TEXT NOT NULL;

-- Foreign key: OrgInvite.invitedById -> User.id
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
