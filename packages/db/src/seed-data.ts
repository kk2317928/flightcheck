export const defaultSocialTemplates = [
  {
    type: 'CANCELLED',
    name: 'default',
    version: 1,
    content:
      '航班 {{flightNumber}} 已確認取消。原定時間：{{scheduledTime}}（澳門時間）。{{detailUrl}}',
    variables: ['flightNumber', 'scheduledTime', 'detailUrl'],
  },
  {
    type: 'DAILY_SUMMARY',
    name: 'default',
    version: 1,
    content:
      '{{serviceDate}} 澳門航空航班共 {{totalFlights}} 班，取消 {{cancelledFlights}} 班，取消率 {{cancellationRate}}。{{summaryUrl}}',
    variables: [
      'serviceDate',
      'totalFlights',
      'cancelledFlights',
      'cancellationRate',
      'summaryUrl',
    ],
  },
] as const;

export const defaultSettings = [
  {
    key: 'flight.delayThresholdMinutes',
    value: 15,
    description: 'Minimum delay in minutes before a flight is delayed.',
  },
  {
    key: 'flight.severeDelayThresholdMinutes',
    value: 60,
    description:
      'Minimum delay in minutes before a flight is severely delayed.',
  },
  {
    key: 'retention.flightSnapshotDays',
    value: 180,
    description: 'Flight snapshot retention period.',
  },
  {
    key: 'retention.scrapeRunDays',
    value: 90,
    description: 'Scrape run retention period.',
  },
] as const;
