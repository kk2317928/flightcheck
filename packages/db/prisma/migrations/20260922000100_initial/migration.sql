-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FlightDirection" AS ENUM ('DEPARTURE', 'ARRIVAL');

-- CreateEnum
CREATE TYPE "OperationalStatus" AS ENUM ('SCHEDULED', 'DEPARTED', 'ARRIVED', 'CANCEL_PENDING', 'CANCELLED', 'RECOVERED', 'DIVERTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PerformanceStatus" AS ENUM ('PENDING', 'ON_TIME', 'DELAYED', 'SEVERE_DELAY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DataQuality" AS ENUM ('COMPLETE', 'DEGRADED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PRELIMINARY', 'FINAL', 'FINAL_WITH_WARNINGS');

-- CreateEnum
CREATE TYPE "ScrapeSource" AS ENUM ('DEPARTURES', 'ARRIVALS');

-- CreateEnum
CREATE TYPE "ScrapeRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialTemplateType" AS ENUM ('CANCELLED', 'DAILY_SUMMARY');

-- CreateEnum
CREATE TYPE "SocialEventType" AS ENUM ('CANCELLED', 'DAILY_SUMMARY');

-- CreateEnum
CREATE TYPE "SocialEventStatus" AS ENUM ('PENDING', 'BLOCKED_DATA_QUALITY', 'PUBLISHING', 'COMPLETED', 'CANCELLED_BEFORE_PUBLISH', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('THREADS', 'FACEBOOK');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('PENDING', 'PUBLISHING', 'SUCCESS', 'FAILED', 'STUCK', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "adminId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flight" (
    "id" UUID NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "airlineCode" TEXT NOT NULL DEFAULT 'NX',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightInstance" (
    "id" UUID NOT NULL,
    "flightId" UUID NOT NULL,
    "serviceDate" DATE NOT NULL,
    "direction" "FlightDirection" NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "scheduledDepartureAt" TIMESTAMPTZ(3),
    "scheduledArrivalAt" TIMESTAMPTZ(3),
    "estimatedAt" TIMESTAMPTZ(3),
    "actualAt" TIMESTAMPTZ(3),
    "originCode" TEXT,
    "destinationCode" TEXT,
    "gate" TEXT,
    "operationalStatus" "OperationalStatus" NOT NULL DEFAULT 'SCHEDULED',
    "performanceStatus" "PerformanceStatus" NOT NULL DEFAULT 'PENDING',
    "delayMinutes" INTEGER,
    "cancelledObservedCount" INTEGER NOT NULL DEFAULT 0,
    "cancelConfirmedAt" TIMESTAMPTZ(3),
    "lastObservedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FlightInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightSnapshot" (
    "id" UUID NOT NULL,
    "flightInstanceId" UUID NOT NULL,
    "scrapeRunId" UUID,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightStatusHistory" (
    "id" UUID NOT NULL,
    "flightInstanceId" UUID NOT NULL,
    "operationalStatus" "OperationalStatus" NOT NULL,
    "performanceStatus" "PerformanceStatus" NOT NULL,
    "delayMinutes" INTEGER,
    "reason" TEXT,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStatistic" (
    "id" UUID NOT NULL,
    "serviceDate" DATE NOT NULL,
    "totalFlights" INTEGER NOT NULL,
    "departureFlights" INTEGER NOT NULL,
    "arrivalFlights" INTEGER NOT NULL,
    "determinedFlights" INTEGER NOT NULL,
    "pendingFlights" INTEGER NOT NULL,
    "onTimeFlights" INTEGER NOT NULL,
    "delayedFlights" INTEGER NOT NULL,
    "severeDelayedFlights" INTEGER NOT NULL,
    "cancelledFlights" INTEGER NOT NULL,
    "unknownFlights" INTEGER NOT NULL,
    "cancellationRate" DECIMAL(7,4),
    "onTimeRate" DECIMAL(7,4),
    "averageDelayMinutes" DECIMAL(10,2),
    "dataQuality" "DataQuality" NOT NULL,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PRELIMINARY',
    "cutoffAt" TIMESTAMPTZ(3) NOT NULL,
    "settledAt" TIMESTAMPTZ(3),
    "warningSummary" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyStatistic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" UUID NOT NULL,
    "source" "ScrapeSource" NOT NULL,
    "status" "ScrapeRunStatus" NOT NULL DEFAULT 'RUNNING',
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "fetchedAt" TIMESTAMPTZ(3),
    "sourceUpdatedAt" TIMESTAMPTZ(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "nxFlightCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialTemplate" (
    "id" UUID NOT NULL,
    "type" "SocialTemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SocialTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialEvent" (
    "id" UUID NOT NULL,
    "type" "SocialEventType" NOT NULL,
    "status" "SocialEventStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "templateId" UUID,
    "payload" JSONB NOT NULL,
    "renderedContent" TEXT NOT NULL,
    "scheduledPublishAt" TIMESTAMPTZ(3) NOT NULL,
    "claimedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SocialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialEventFlight" (
    "socialEventId" UUID NOT NULL,
    "flightInstanceId" UUID NOT NULL,
    "relationRole" TEXT,

    CONSTRAINT "SocialEventFlight_pkey" PRIMARY KEY ("socialEventId","flightInstanceId")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" UUID NOT NULL,
    "socialEventId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "claimedAt" TIMESTAMPTZ(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminId_expiresAt_idx" ON "AdminSession"("adminId", "expiresAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Flight_flightNumber_key" ON "Flight"("flightNumber");

-- CreateIndex
CREATE INDEX "FlightInstance_serviceDate_direction_idx" ON "FlightInstance"("serviceDate", "direction");

-- CreateIndex
CREATE INDEX "FlightInstance_operationalStatus_scheduledAt_idx" ON "FlightInstance"("operationalStatus", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "flight_instance_identity_key" ON "FlightInstance"("flightId", "serviceDate", "direction", "scheduledAt");

-- CreateIndex
CREATE INDEX "FlightSnapshot_observedAt_idx" ON "FlightSnapshot"("observedAt");

-- CreateIndex
CREATE INDEX "FlightSnapshot_scrapeRunId_idx" ON "FlightSnapshot"("scrapeRunId");

-- CreateIndex
CREATE UNIQUE INDEX "flight_snapshot_hash_key" ON "FlightSnapshot"("flightInstanceId", "payloadHash");

-- CreateIndex
CREATE INDEX "FlightStatusHistory_flightInstanceId_observedAt_idx" ON "FlightStatusHistory"("flightInstanceId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStatistic_serviceDate_key" ON "DailyStatistic"("serviceDate");

-- CreateIndex
CREATE INDEX "DailyStatistic_settlementStatus_serviceDate_idx" ON "DailyStatistic"("settlementStatus", "serviceDate");

-- CreateIndex
CREATE INDEX "ScrapeRun_source_startedAt_idx" ON "ScrapeRun"("source", "startedAt");

-- CreateIndex
CREATE INDEX "ScrapeRun_status_startedAt_idx" ON "ScrapeRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "SocialTemplate_type_isActive_idx" ON "SocialTemplate"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SocialTemplate_type_name_version_key" ON "SocialTemplate"("type", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SocialEvent_idempotencyKey_key" ON "SocialEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SocialEvent_status_scheduledPublishAt_idx" ON "SocialEvent"("status", "scheduledPublishAt");

-- CreateIndex
CREATE INDEX "SocialEvent_type_createdAt_idx" ON "SocialEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SocialEventFlight_flightInstanceId_idx" ON "SocialEventFlight"("flightInstanceId");

-- CreateIndex
CREATE INDEX "SocialPost_status_nextAttemptAt_idx" ON "SocialPost"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_event_platform_key" ON "SocialPost"("socialEventId", "platform");

-- CreateIndex
CREATE INDEX "JobLock_expiresAt_idx" ON "JobLock"("expiresAt");

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightInstance" ADD CONSTRAINT "FlightInstance_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightSnapshot" ADD CONSTRAINT "FlightSnapshot_flightInstanceId_fkey" FOREIGN KEY ("flightInstanceId") REFERENCES "FlightInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightSnapshot" ADD CONSTRAINT "FlightSnapshot_scrapeRunId_fkey" FOREIGN KEY ("scrapeRunId") REFERENCES "ScrapeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightStatusHistory" ADD CONSTRAINT "FlightStatusHistory_flightInstanceId_fkey" FOREIGN KEY ("flightInstanceId") REFERENCES "FlightInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialEvent" ADD CONSTRAINT "SocialEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SocialTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialEventFlight" ADD CONSTRAINT "SocialEventFlight_socialEventId_fkey" FOREIGN KEY ("socialEventId") REFERENCES "SocialEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialEventFlight" ADD CONSTRAINT "SocialEventFlight_flightInstanceId_fkey" FOREIGN KEY ("flightInstanceId") REFERENCES "FlightInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_socialEventId_fkey" FOREIGN KEY ("socialEventId") REFERENCES "SocialEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
