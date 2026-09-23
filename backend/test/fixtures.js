export const catalog = [
  { sku: 'EXACT', article: 'SKU-EXACT', name: '3P C16 10 kA', poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, priceKzt: 12000, stock: 2, certificates: [{ name: 'Demo certificate', url: 'https://example.org/certificate.pdf' }] },
  { sku: 'ALT-15', name: '3P C16 15 kA', poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 15, priceKzt: 14000, stock: 10 },
  { sku: 'ALT-20', name: '3P C16 20 kA', poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 20, priceKzt: 16000, stock: 8 },
  { sku: 'WRONG-POLES', name: '1P C16 15 kA', poles: 1, curve: 'C', amps: 16, breakingCapacityKa: 15, priceKzt: 5000, stock: 20 },
  { sku: 'WRONG-CURVE', name: '3P B16 15 kA', poles: 3, curve: 'B', amps: 16, breakingCapacityKa: 15, priceKzt: 13000, stock: 20 },
  { sku: 'LOW-CAPACITY', name: '3P C16 6 kA', poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 6, priceKzt: 9000, stock: 20 },
];
