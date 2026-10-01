import fs from 'node:fs';
const genesis=fs.existsSync('runtime/chain-genesis.json')?JSON.parse(fs.readFileSync('runtime/chain-genesis.json','utf8')).timestamp:Math.floor(Date.now()/1000);
export default { solidity: "0.8.30", networks: {
  node: { type: "edr-simulated", chainId:31337, initialDate:new Date(genesis*1000).toISOString(), mining:{auto:true} },
  local: { type: "http", url: "http://127.0.0.1:18545", chainId: 31337 }
} };
