ALTER TABLE "FlightStatusHistory"
  ADD COLUMN "previousOperationalStatus" "OperationalStatus",
  ADD COLUMN "previousPerformanceStatus" "PerformanceStatus",
  ADD COLUMN "previousDelayMinutes" INTEGER;
