# Azure Event Hubs (Kafka OAUTHBEARER)

RedfireForge does not install the Azure CLI, sign you in, or store an Azure client secret. When a Kafka cluster uses **Azure OAUTHBEARER**, the app asks the Azure CLI already on this machine for a token.

## Before you connect

1. Install the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) so the `az` command is available.
2. Sign in:

   ```bash
   az login
   ```

3. In **Kafka → Settings**, create a cluster:
   - **Broker:** `<namespace>.servicebus.windows.net:9093`
   - **Mechanism:** Azure OAUTHBEARER
   - **TLS:** on

The account from `az login` must be allowed to use that Event Hubs namespace.

## How the token is requested

The first broker whose host ends in `.servicebus.windows.net` is the token resource. For `my-namespace.servicebus.windows.net:9093`, RedfireForge runs:

```bash
az account get-access-token --resource https://my-namespace.servicebus.windows.net --output json
```

The `accessToken` in that JSON is sent to the broker as the Kafka OAUTHBEARER token. The desktop app asks for a new token when the current one expires.

If `az` is missing or the login has expired, connect fails and asks you to install the Azure CLI and run `az login` again.
