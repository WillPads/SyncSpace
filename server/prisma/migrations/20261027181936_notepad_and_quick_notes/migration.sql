-- CreateTable
CREATE TABLE "NotepadItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "body" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotepadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickNote" (
    "userId" TEXT NOT NULL,
    "body" VARCHAR(5000) NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickNote_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotepadItem_userId_slot_key" ON "NotepadItem"("userId", "slot");

-- AddForeignKey
ALTER TABLE "NotepadItem" ADD CONSTRAINT "NotepadItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickNote" ADD CONSTRAINT "QuickNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added (Prisma can't express CHECK constraints): the notepad has exactly 5 slots, numbered 0-4.
ALTER TABLE "NotepadItem" ADD CONSTRAINT "NotepadItem_slot_range" CHECK ("slot" BETWEEN 0 AND 4);
