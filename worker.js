export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname.split("/").filter(Boolean);
        const method = request.method;

        const authHeader = request.headers.get("Authorization");
        if (authHeader !== `Bearer ${env.API_TOKEN}`) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        try {
            if (path[0] === "collections") {
                if (method === "GET" && path.length === 1) return listCollections(env);
                if (method === "POST" && path.length === 1) return createCollection(request, env);
                if (path.length === 2) {
                    const collectionId = path[1];
                    if (method === "GET") return getCollection(collectionId, env);
                    if (method === "PUT") return updateCollection(collectionId, request, env);
                    if (method === "DELETE") return deleteCollection(collectionId, env);
                }
            }

            if (path[0] === "collections" && path[2] === "notes") {
                const collectionId = path[1];

                if (method === "GET" && path.length === 3)
                    return listNotes(collectionId, env);
                if (method === "POST" && path.length === 3)
                    return createNote(collectionId, request, env);

                if (path.length === 4) {
                    const noteId = path[3];
                    if (method === "GET") return getNote(collectionId, noteId, env);
                    if (method === "PUT") return updateNote(collectionId, noteId, request, env);
                    if (method === "DELETE") return deleteNote(collectionId, noteId, env);
                }
            }

            return new Response(JSON.stringify({ error: "Not found" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
    },
};

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function listCollections(env) {
    const list = await env.NOTES_KV.list({ prefix: "collection:" });
    const collections = (await Promise.all(
        list.keys.map(async (key) => {
            const data = await env.NOTES_KV.get(key.name, { type: "json" });
            return data;
        })
    )).filter(item => item !== null);
    return json(collections);
}

async function createCollection(request, env) {
    const body = await request.json();
    const id = crypto.randomUUID();
    const collection = { id, name: body.name || "Untitled", created: Date.now() };
    await env.NOTES_KV.put(`collection:${id}`, JSON.stringify(collection));
    return json(collection, 201);
}

async function getCollection(id, env) {
    const data = await env.NOTES_KV.get(`collection:${id}`, { type: "json" });
    if (!data) return notFound();
    return json(data);
}

async function updateCollection(id, request, env) {
    const existing = await env.NOTES_KV.get(`collection:${id}`, { type: "json" });
    if (!existing) return notFound();
    const body = await request.json();
    const updated = { ...existing, ...body };
    await env.NOTES_KV.put(`collection:${id}`, JSON.stringify(updated));
    return json(updated);
}

async function deleteCollection(id, env) {
    await env.NOTES_KV.delete(`collection:${id}`);
    const notes = await env.NOTES_KV.list({ prefix: `note:${id}:` });
    await Promise.all(notes.keys.map(k => env.NOTES_KV.delete(k.name)));
    return json({ success: true });
}

async function listNotes(collectionId, env) {
    const list = await env.NOTES_KV.list({ prefix: `note:${collectionId}:` });
    const notes = (await Promise.all(
        list.keys.map(async (key) => {
            const data = await env.NOTES_KV.get(key.name, { type: "json" });
            return data;
        })
    )).filter(item => item !== null);
    return json(notes);
}

async function createNote(collectionId, request, env) {
    const body = await request.json();
    const id = crypto.randomUUID();
    const note = { id, collectionId, text: body.text || "", created: Date.now() };
    await env.NOTES_KV.put(`note:${collectionId}:${id}`, JSON.stringify(note));
    return json(note, 201);
}

async function getNote(collectionId, noteId, env) {
    const data = await env.NOTES_KV.get(`note:${collectionId}:${noteId}`, { type: "json" });
    if (!data) return notFound();
    return json(data);
}

async function updateNote(collectionId, noteId, request, env) {
    const existing = await env.NOTES_KV.get(`note:${collectionId}:${noteId}`, { type: "json" });
    if (!existing) return notFound();
    const body = await request.json();
    const updated = { ...existing, ...body };
    await env.NOTES_KV.put(`note:${collectionId}:${noteId}`, JSON.stringify(updated));
    return json(updated);
}

async function deleteNote(collectionId, noteId, env) {
    await env.NOTES_KV.delete(`note:${collectionId}:${noteId}`);
    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders
        },
    });
}

function notFound() {
    return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders
        }
    });
}