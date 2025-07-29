import fs from "fs";
import path from "path";

export interface DeploymentAddresses {
  wrappedNative: { name: string; address: string };
  usdt: { name: string; address: string };
  dai: { name: string; address: string };
  limitOrderProtocol: { address: string };
  uniteEscrowFactory: { address: string };
}

export interface ChainDeployment {
  chainId: number;
  chainName: string;
  contracts: DeploymentAddresses;
  deployer: string;
  rpcUrl?: string;
}

export function loadDeployments(): Record<number, ChainDeployment> {
  const deploymentPath = path.resolve(__dirname, "../../../resolver/contracts/deployments.json");
  
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found at ${deploymentPath}`);
  }
  
  const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  const chainDeployments: Record<number, ChainDeployment> = {};
  
  // Map deployment data to chainId-indexed format
  for (const [networkKey, deployment] of Object.entries(deploymentData)) {
    if (networkKey === "notes") continue;
    
    const chainData = deployment as any;
    
    // Skip Etherlink testnet (128123) due to insufficient funds
    if (chainData.chainId === 128123) {
      console.log('Skipping Etherlink testnet (128123) - insufficient funds');
      continue;
    }
    
    chainDeployments[chainData.chainId] = {
      chainId: chainData.chainId,
      chainName: chainData.chainName,
      contracts: chainData.contracts,
      deployer: chainData.deployer,
      rpcUrl: chainData.rpcUrl
    };
  }
  
  return chainDeployments;
}

export function getChainDeployment(chainId: number): ChainDeployment | undefined {
  const deployments = loadDeployments();
  return deployments[chainId];
}

export function getContractAddress(chainId: number, contractName: keyof DeploymentAddresses): string | undefined {
  const deployment = getChainDeployment(chainId);
  if (!deployment) return undefined;
  
  const contract = deployment.contracts[contractName];
  return typeof contract === "object" ? contract.address : contract;
}