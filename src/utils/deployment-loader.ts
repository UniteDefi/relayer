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
  const deploymentPath = path.resolve(__dirname, "../../../resolver/deployments.json");

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found at ${deploymentPath}`);
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  const chainDeployments: Record<number, ChainDeployment> = {};

  // Parse the EVM deployments from the new JSON structure
  if (deploymentData.evm) {
    for (const [networkKey, deployment] of Object.entries(deploymentData.evm)) {
      const chainData = deployment as any;

      // Skip Etherlink testnet (128123) due to insufficient funds
      if (chainData.chainId === 128123) {
        console.log("Skipping Etherlink testnet (128123) - insufficient funds");
        continue;
      }

      // Map the flat contract addresses to the expected contracts structure
      const contracts: DeploymentAddresses = {
        wrappedNative: {
          name: "MockWrappedNative",
          address: chainData.MockWrappedNative || "0x0000000000000000000000000000000000000000"
        },
        usdt: {
          name: "MockUSDT",
          address: chainData.MockUSDT || "0x0000000000000000000000000000000000000000"
        },
        dai: {
          name: "MockDAI", 
          address: chainData.MockDAI || "0x0000000000000000000000000000000000000000"
        },
        limitOrderProtocol: {
          address: chainData.UniteLimitOrderProtocol || chainData.LimitOrderProtocol || "0x0000000000000000000000000000000000000000"
        },
        uniteEscrowFactory: {
          address: chainData.UniteEscrowFactory || chainData.EscrowFactory || "0x0000000000000000000000000000000000000000"
        }
      };

      chainDeployments[chainData.chainId] = {
        chainId: chainData.chainId,
        chainName: chainData.name,
        contracts: contracts,
        deployer: "0x0000000000000000000000000000000000000000", // Not provided in current JSON
        rpcUrl: undefined // Not provided in current JSON, will use fallbacks in config
      };
    }
  }

  return chainDeployments;
}

export function getChainDeployment(chainId: number): ChainDeployment | undefined {
  const deployments = loadDeployments();
  return deployments[chainId];
}

export function getContractAddress(
  chainId: number,
  contractName: keyof DeploymentAddresses
): string | undefined {
  const deployment = getChainDeployment(chainId);
  if (!deployment) return undefined;

  const contract = deployment.contracts[contractName];
  return typeof contract === "object" ? contract.address : contract;
}
