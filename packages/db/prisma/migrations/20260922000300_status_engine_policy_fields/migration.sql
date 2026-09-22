ALTER TABLE "FlightInstance"
ADD COLUMN "scheduleVarianceMinutes" INTEGER;

ALTER TABLE "FlightStatusHistory"
ADD COLUMN "previousScheduleVarianceMinutes" INTEGER,
ADD COLUMN "scheduleVarianceMinutes" INTEGER;
