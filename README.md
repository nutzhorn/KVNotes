# KV Notes Worker

A lightweight, serverless REST API for managing notes and collections. This project is built on [Cloudflare Workers](https://workers.cloudflare.com/) and uses [Cloudflare Workers KV](https://developers.cloudflare.com/kv/) for data storage.

## Features

* **Collections & Notes**: Organize notes into specific collections.
* **RESTful API**: Full CRUD (Create, Read, Update, Delete) support for both collections and notes.
* **Secure**: Simple Bearer Token authentication.
* **Fast**: Deployed to the edge using Cloudflare's global network.
* **CORS Enabled**: Ready for frontend integration with full CORS support.

## Prerequisites

* A free/paid [Cloudflare](https://www.cloudflare.com/) account.

## Setup & Deployment

1.  **Create the Worker**
    * Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
    * Navigate to **Workers & Pages** > **Create Application** > **Start with Hello World!**.
    * Name your worker (e.g., `kvnotes`) and click **Deploy**.

2.  **Add the Code**
    * On the worker page, click **Edit code**.
    * Delete the default code in the editor.
    * Copy the full contents of `worker.js` from this repository and paste it into the editor.
    * Click **Deploy**.

3.  **Create a KV Namespace**
    * Go to the sidebar and nativgate to **Storage & databases** > **Workers KV** > **Create instance**.
    * Click **Create a namespace**.
    * Enter a name (e.g., `notes`) and click **Create**.

4.  **Configure Bindings**
    * Go back to your Worker's overview page.
    * Click the **Bindings** tab and select **Add Binding**.
    * Find **KV namespace** and click **Add binding**.
    * **Variable name**: Enter `NOTES_KV` (This must match exactly).
    * **KV Namespace**: Select the namespace you created in Step 3.
    * Click **Add Binding**.

5.  **Set the API Token**
    * Now nativgate to **Settings** and locate the **Variables and Secrets** section.
    * Click **Add**.
    * **Type:** Secret
    * **Variable name**: Enter `API_TOKEN`.
    * **Value**: Enter a secure secret password of your choice.
    * Then click **Deploy**.

## Connect to Online Client (Optional)

You can use the offical [KVNotes web client](https://kvnotes.tech) to manage your notes via a user interface. 
The client itself is **open source** and its source code is available on GitHub: [KVNotes Client Source Code](https://github.com/nutzhorn/kvnotes).

Once your worker is deployed, you can connect it to the client to manage your notes via a UI.
1.  **Open the Web Client**
    Navigate to [https://kvnotes.tech](https://kvnotes.tech).

2.  **Enter Your Details**
    * **API URL**: Enter the full URL of your deployed worker (e.g., `https://kvnotes.your-user.workers.dev`).
    * **API Token**: Enter the secret value you set for the `API_TOKEN` environment variable in Step 5 above.

3.  **Connect**
    Click the **Connect** button. The client will authenticate with your backend and sync your collections.