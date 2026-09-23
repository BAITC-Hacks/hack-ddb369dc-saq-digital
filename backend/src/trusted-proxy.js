import { lookup } from 'node:dns/promises';

export function trustedProxyFor(hostname, resolveHost = lookup) {
  let addresses = new Set();
  return {
    isTrusted(address) {
      return addresses.has(address.replace(/^::ffff:/, ''));
    },
    async refresh() {
      try {
        const records = await resolveHost(hostname, { all: true });
        addresses = new Set(records.map(({ address }) => address));
      } catch {
        // Fail closed when the frontend container is not yet on the network.
        addresses = new Set();
      }
    },
  };
}
