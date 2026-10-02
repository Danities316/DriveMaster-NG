-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');

-- AlterTable
ALTER TABLE "vehicles" ALTER COLUMN "status" TYPE "VehicleStatus" USING "status"::"VehicleStatus";