// Separate disposable validation node; never opens this app's runtime or existing node.
export default {
  networks: {
    deploymentValidation: { type: 'edr-simulated', chainId: 31337, initialDate: new Date('2026-10-01T00:00:00Z'), mining: { auto: true } }
  }
};
