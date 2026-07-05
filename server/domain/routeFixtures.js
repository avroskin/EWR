'use strict';

const imsPorts = [
  { port: 'Jeddah', role: 'jeddah_departure', visibleLabel: 'Jeddah Departure', eta: null, ets: '2026-01-10T06:00:00.000Z', omit: false },
  { port: 'Nhava Sheva', eta: '2026-01-15T08:00:00.000Z', ets: '2026-01-16T18:00:00.000Z', omit: false },
  { port: 'Mundra', eta: '2026-01-17T08:00:00.000Z', ets: '2026-01-18T18:00:00.000Z', omit: false },
  { port: 'Jeddah', role: 'jeddah_arrival', visibleLabel: 'Jeddah Arrival', eta: '2026-01-24T22:00:00.000Z', ets: null, omit: false }
];

const fixtures = [
  {
    name: 'IMS normal with Jeddah departure and arrival',
    voyage: { zone: 'gulf_of_aden', portCalls: imsPorts },
    expect: {
      suggestions: [
        { windowKey: 'hra_outbound', status: 'ok', entry: '2026-01-10T20:00:00.000Z', exit: '2026-01-12T20:00:00.000Z' },
        { windowKey: 'hra_inbound', status: 'ok', entry: '2026-01-22T08:00:00.000Z', exit: '2026-01-24T08:00:00.000Z' }
      ]
    }
  },
  {
    name: 'IMS missing Jeddah departure',
    voyage: {
      zone: 'gulf_of_aden',
      portCalls: imsPorts.map(port => port.role === 'jeddah_departure' ? { ...port, ets: null } : port)
    },
    expect: {
      suggestions: [
        { windowKey: 'hra_outbound', status: 'missing_anchor', entry: null, exit: null },
        { windowKey: 'hra_inbound', status: 'ok', entry: '2026-01-22T08:00:00.000Z', exit: '2026-01-24T08:00:00.000Z' }
      ]
    }
  },
  {
    name: 'IMS missing Jeddah arrival',
    voyage: {
      zone: 'gulf_of_aden',
      portCalls: imsPorts.map(port => port.role === 'jeddah_arrival' ? { ...port, eta: null } : port)
    },
    expect: {
      suggestions: [
        { windowKey: 'hra_outbound', status: 'ok', entry: '2026-01-10T20:00:00.000Z', exit: '2026-01-12T20:00:00.000Z' },
        { windowKey: 'hra_inbound', status: 'missing_anchor', entry: null, exit: null }
      ]
    }
  },
  {
    name: 'MAS normal Tincan and Apapa',
    voyage: {
      zone: 'mas_combined',
      portCalls: [
        { port: 'Beirut', eta: '2026-02-01T08:00:00.000Z', ets: '2026-02-02T08:00:00.000Z', omit: false },
        { port: 'Lattakia', eta: '2026-02-03T08:00:00.000Z', ets: '2026-02-04T08:00:00.000Z', omit: false },
        { port: 'Tincan', eta: '2026-02-10T12:00:00.000Z', ets: '2026-02-11T14:00:00.000Z', omit: false },
        { port: 'Apapa', eta: '2026-02-12T06:00:00.000Z', ets: '2026-02-13T18:00:00.000Z', omit: false },
        { port: 'Cotonou', eta: '2026-02-15T08:00:00.000Z', ets: '2026-02-16T08:00:00.000Z', omit: false }
      ]
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'ok', entry: '2026-02-10T02:00:00.000Z', exit: '2026-02-14T04:00:00.000Z' }
      ]
    }
  },
  {
    name: 'MAS omitted Apapa',
    voyage: {
      zone: 'mas_combined',
      portCalls: [
        { port: 'Tincan', eta: '2026-03-10T12:00:00.000Z', ets: '2026-03-11T14:00:00.000Z', omit: false },
        { port: 'Apapa', eta: '2026-03-12T06:00:00.000Z', ets: '2026-03-13T18:00:00.000Z', omit: true }
      ]
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'ok', entry: '2026-03-10T02:00:00.000Z', exit: '2026-03-12T00:00:00.000Z' }
      ],
      preservedPort: { port: 'Apapa', eta: '2026-03-12T06:00:00.000Z', ets: '2026-03-13T18:00:00.000Z', omit: true }
    }
  },
  {
    name: 'MAS missing formula ports',
    voyage: {
      zone: 'mas_combined',
      portCalls: [
        { port: 'Beirut', eta: '2026-04-01T08:00:00.000Z', ets: '2026-04-02T08:00:00.000Z', omit: false },
        { port: 'Cotonou', eta: '2026-04-10T08:00:00.000Z', ets: '2026-04-11T08:00:00.000Z', omit: false }
      ]
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'missing_anchor', entry: null, exit: null }
      ]
    }
  },
  {
    name: 'Black Sea normal Novorossiysk',
    voyage: {
      zone: 'black_sea',
      portCalls: [
        { port: 'Novorossiysk', eta: '2026-05-05T12:00:00.000Z', ets: '2026-05-07T18:00:00.000Z', omit: false }
      ]
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'ok', entry: '2026-05-05T00:00:00.000Z', exit: '2026-05-08T06:00:00.000Z' }
      ]
    }
  },
  {
    name: 'Libya port-only',
    voyage: {
      zone: 'north_africa',
      portCalls: [
        { port: 'Misurata', eta: '2026-06-01T08:00:00.000Z', ets: '2026-06-02T08:00:00.000Z', omit: false },
        { port: 'Benghazi', eta: '2026-06-03T08:00:00.000Z', ets: '2026-06-04T08:00:00.000Z', omit: false }
      ]
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'not_applicable', entry: null, exit: null }
      ]
    }
  },
  {
    name: 'Zeynep C no-zone record',
    voyage: {
      zone: 'zeynep_c',
      isZeynepC: true,
      portCalls: [{ port: 'Anchorage', eta: '2026-07-01T08:00:00.000Z', ets: '2026-07-01T18:00:00.000Z', omit: false }],
      zoneWindows: []
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'disabled', entry: null, exit: null }
      ]
    }
  },
  {
    name: 'Zeynep C flexible manual zone record',
    voyage: {
      zone: 'zeynep_c',
      isZeynepC: true,
      zeynepZoneName: 'Black Sea EWR',
      portCalls: [{ port: 'Chornomorsk', eta: '2026-08-02T10:00:00.000Z', ets: '2026-08-03T10:00:00.000Z', omit: false }],
      zoneWindows: [
        { key: 'main', label: 'Black Sea EWR', enabled: true, entry: '2026-08-02T00:00:00.000Z', exit: '2026-08-03T22:00:00.000Z' }
      ]
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'manual_needed', entry: '2026-08-02T00:00:00.000Z', exit: '2026-08-03T22:00:00.000Z' }
      ]
    }
  },
  {
    name: 'Omitted port with times preserved',
    voyage: {
      zone: 'mas_combined',
      portCalls: [
        { port: 'Tincan', eta: '2026-09-10T12:00:00.000Z', ets: '2026-09-11T14:00:00.000Z', omit: false },
        { port: 'Apapa', eta: '2026-09-12T06:00:00.000Z', ets: '2026-09-13T18:00:00.000Z', omit: true }
      ]
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'ok', entry: '2026-09-10T02:00:00.000Z', exit: '2026-09-12T00:00:00.000Z' }
      ],
      preservedPort: { port: 'Apapa', eta: '2026-09-12T06:00:00.000Z', ets: '2026-09-13T18:00:00.000Z', omit: true }
    }
  },
  {
    name: 'Confirmed field not overwritten by calculation',
    voyage: {
      zone: 'black_sea',
      portCalls: [
        { port: 'Novorossiysk', eta: '2026-10-05T12:00:00.000Z', ets: '2026-10-07T18:00:00.000Z', omit: false }
      ],
      zoneEntry: '2026-10-04T10:00:00.000Z',
      zoneEntryConfirmed: true,
      zoneExit: null,
      zoneExitConfirmed: false
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'ok', entry: '2026-10-05T00:00:00.000Z', exit: '2026-10-08T06:00:00.000Z' }
      ],
      applied: {
        zoneEntry: '2026-10-04T10:00:00.000Z',
        zoneExit: '2026-10-08T06:00:00.000Z'
      }
    }
  },
  {
    name: 'Manual unconfirmed zone time overwritten by calculation',
    voyage: {
      zone: 'black_sea',
      portCalls: [
        { port: 'Novorossiysk', eta: '2026-11-05T12:00:00.000Z', ets: '2026-11-07T18:00:00.000Z', omit: false }
      ],
      zoneEntry: '2026-11-04T10:00:00.000Z',
      zoneEntryConfirmed: false,
      zoneEntryCalculated: '2026-11-05T00:00:00.000Z',
      zoneExit: '2026-11-08T06:00:00.000Z',
      zoneExitConfirmed: false,
      zoneExitCalculated: '2026-11-08T06:00:00.000Z'
    },
    expect: {
      suggestions: [
        { windowKey: 'main', status: 'ok', entry: '2026-11-05T00:00:00.000Z', exit: '2026-11-08T06:00:00.000Z' }
      ],
      applied: {
        zoneEntry: '2026-11-05T00:00:00.000Z',
        zoneExit: '2026-11-08T06:00:00.000Z'
      }
    }
  }
];

module.exports = fixtures;
