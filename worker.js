export default {
  async fetch(request, env, ctx) {
    const { method, url } = request;
    const { pathname } = new URL(url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
      // ── AUTH: LOGIN ─────────────────────────────────────────────
      if (method === "POST" && pathname === "/auth/login") {
        const { usuario, password } = await request.json();
        if (!usuario || !password) {
          return Response.json({ error: "Usuario y contraseña son requeridos" }, { status: 400, headers: corsHeaders });
        }
        if (usuario !== env["system-user"] || password !== env["system-password"]) {
          return Response.json({ error: "Usuario o contraseña incorrectos" }, { status: 401, headers: corsHeaders });
        }
        const token = await generateToken(usuario, env["system-password"]);
        return Response.json({ token }, { headers: corsHeaders });
      }

      // ── AUTH: VERIFICAR TOKEN en operaciones protegidas ──────────
      const isProtected =
        pathname === "/upload-imagen" ||
        (pathname === "/categoria/reorder") ||
        (pathname === "/catalogo/reorder") ||
        (pathname === "/categoria" && method !== "GET") ||
        (pathname === "/catalogo"  && method !== "GET");

      if (isProtected) {
        const authHeader = request.headers.get("Authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!(await verifyToken(token, env["system-password"]))) {
          return Response.json({ error: "No autorizado" }, { status: 401, headers: corsHeaders });
        }
      }

      // ── SUBIR IMAGEN A CLOUDINARY ───────────────────────────
      if (method === "POST" && pathname === "/upload-imagen") {
        const { imagen_base64 } = await request.json();

        if (!imagen_base64) {
          return Response.json(
            { error: "imagen_base64 requerido" },
            { status: 400, headers: corsHeaders }
          );
        }

        const cloudName = env.CLOUDINARY_CLOUD_NAME;
        const apiKey    = env.CLOUDINARY_API_KEY;
        const apiSecret = env.CLOUDINARY_API_SECRET;
        const folder    = "ami-floreria/catalogo";
        const timestamp = Math.floor(Date.now() / 1000);

        const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
        const msgBuffer = new TextEncoder().encode(toSign);
        const hashBuffer = await crypto.subtle.digest("SHA-1", msgBuffer);
        const signature = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");

        const form = new FormData();
        form.append("file", `data:image/jpeg;base64,${imagen_base64}`);
        form.append("api_key", apiKey);
        form.append("timestamp", timestamp.toString());
        form.append("signature", signature);
        form.append("folder", folder);

        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          { method: "POST", body: form }
        );

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Cloudinary upload → ${res.status}: ${errBody}`);
        }

        const data = await res.json();

        return Response.json({
          url:       data.secure_url,
          public_id: data.public_id,
        }, { headers: corsHeaders });
      }

      // ── CATEGORIA REORDER ───────────────────────────────────
      if (method === "PUT" && pathname === "/categoria/reorder") {
        const categorias = await request.json();
        const statements = categorias.map(cat =>
          env.DB.prepare("UPDATE categoria SET orden = ? WHERE nombre = ?")
            .bind(cat.orden, cat.nombre)
        );
        await env.DB.batch(statements);
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // ── CATALOGO REORDER ────────────────────────────────────
      if (method === "PUT" && pathname === "/catalogo/reorder") {
        const items = await request.json();
        if (!Array.isArray(items) || items.length === 0) {
          return Response.json({ error: "Lista de items requerida" }, { status: 400, headers: corsHeaders });
        }
        const statements = items.map(item =>
          env.DB.prepare("UPDATE catalogo SET orden = ? WHERE id = ?")
            .bind(item.orden, item.id)
        );
        await env.DB.batch(statements);
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // ── CATEGORIA ───────────────────────────────────────────
      if (pathname === "/categoria") {
        if (method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM categoria ORDER BY orden ASC"
          ).all();
          return Response.json(results, { headers: corsHeaders });
        }

        if (method === "POST") {
          const { nombre, orden } = await request.json();
          await env.DB.prepare(
            "INSERT INTO categoria (nombre, orden) VALUES (?, ?)"
          ).bind(nombre, orden).run();
          return Response.json({ success: true }, { status: 201, headers: corsHeaders });
        }

        if (method === "DELETE") {
          const { nombre } = await request.json();
          await env.DB.prepare(
            "DELETE FROM categoria WHERE nombre = ?"
          ).bind(nombre).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      // ── CATALOGO ────────────────────────────────────────────
      if (pathname === "/catalogo") {

        // GET — devuelve cada producto con su array de categorías, ordenado por orden ASC
        if (method === "GET") {
          const { results } = await env.DB.prepare(`
            SELECT c.id, c.nombre, c.descripcion, c.imagen_url, c.imagen_public_id, c.precio, c.orden,
                   GROUP_CONCAT(cc.categoria_nombre) AS categorias_raw
            FROM catalogo c
            LEFT JOIN catalogo_categoria cc ON c.id = cc.catalogo_id
            GROUP BY c.id
            ORDER BY c.orden ASC, c.id ASC
          `).all();

          const products = results.map(r => {
            const { categorias_raw, ...rest } = r;
            return { ...rest, categorias: categorias_raw ? categorias_raw.split(',') : [] };
          });

          return Response.json(products, { headers: corsHeaders });
        }

        // POST — crear producto con múltiples categorías
        if (method === "POST") {
          const { nombre, descripcion, imagen_url, imagen_public_id, categorias, precio } = await request.json();

          if (!Array.isArray(categorias) || categorias.length === 0) {
            return Response.json({ error: "Debes asignar al menos una categoría" }, { status: 400, headers: corsHeaders });
          }
          if (precio == null || isNaN(Number(precio))) {
            return Response.json({ error: "El precio es obligatorio y debe ser un número" }, { status: 400, headers: corsHeaders });
          }

          // Asignar orden = max(orden) + 1 para que quede al final
          const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(orden), 0) + 1 AS next FROM catalogo").first();
          const orden  = maxRow.next;

          const result = await env.DB.prepare(
            "INSERT INTO catalogo (nombre, descripcion, imagen_url, imagen_public_id, precio, orden) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(nombre, descripcion, imagen_url, imagen_public_id || "", Number(precio), orden).run();

          const newId = result.meta.last_row_id;

          await env.DB.batch(
            categorias.map(cat =>
              env.DB.prepare("INSERT INTO catalogo_categoria (catalogo_id, categoria_nombre) VALUES (?, ?)")
                .bind(newId, cat)
            )
          );

          return Response.json({
            success: true,
            producto: {
              id: newId,
              nombre, descripcion, imagen_url,
              imagen_public_id: imagen_public_id || "",
              categorias,
              precio: Number(precio),
              orden,
            }
          }, { status: 201, headers: corsHeaders });
        }

        // PUT — actualizar producto y reemplazar categorías
        if (method === "PUT") {
          const { id, nombre, descripcion, imagen_url, imagen_public_id, categorias, precio } = await request.json();

          if (!Array.isArray(categorias) || categorias.length === 0) {
            return Response.json({ error: "Debes asignar al menos una categoría" }, { status: 400, headers: corsHeaders });
          }
          if (precio == null || isNaN(Number(precio))) {
            return Response.json({ error: "El precio es obligatorio y debe ser un número" }, { status: 400, headers: corsHeaders });
          }

          const existing = await env.DB.prepare(
            "SELECT imagen_url, imagen_public_id FROM catalogo WHERE id = ?"
          ).bind(id).first();

          if (existing && existing.imagen_url !== imagen_url && existing.imagen_public_id) {
            ctx.waitUntil(
              destroyCloudinaryImage(env, existing.imagen_public_id).catch(() => {})
            );
          }

          await env.DB.prepare(
            "UPDATE catalogo SET nombre = ?, descripcion = ?, imagen_url = ?, imagen_public_id = ?, precio = ? WHERE id = ?"
          ).bind(nombre, descripcion, imagen_url, imagen_public_id || "", Number(precio), id).run();

          // Reemplazar asociaciones de categorías
          await env.DB.batch([
            env.DB.prepare("DELETE FROM catalogo_categoria WHERE catalogo_id = ?").bind(id),
            ...categorias.map(cat =>
              env.DB.prepare("INSERT INTO catalogo_categoria (catalogo_id, categoria_nombre) VALUES (?, ?)")
                .bind(id, cat)
            ),
          ]);

          return Response.json({ success: true }, { headers: corsHeaders });
        }

        // DELETE — eliminar producto y sus relaciones
        if (method === "DELETE") {
          const { id } = await request.json();

          const prod = await env.DB.prepare(
            "SELECT imagen_public_id FROM catalogo WHERE id = ?"
          ).bind(id).first();

          // Eliminar relaciones explícitamente (no asumir CASCADE en D1)
          await env.DB.batch([
            env.DB.prepare("DELETE FROM catalogo_categoria WHERE catalogo_id = ?").bind(id),
            env.DB.prepare("DELETE FROM catalogo WHERE id = ?").bind(id),
          ]);

          if (prod?.imagen_public_id) {
            ctx.waitUntil(
              destroyCloudinaryImage(env, prod.imagen_public_id).catch(() => {})
            );
          }

          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};

// ── Helper: HMAC-SHA256 ─────────────────────────────────────
async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Helper: Generar token (válido 8 horas) ──────────────────
async function generateToken(username, secret) {
  const exp     = Math.floor(Date.now() / 1000) + 8 * 3600;
  const payload = `${username}|${exp}`;
  const sig     = await hmacSign(secret, payload);
  return btoa(payload) + "." + sig;
}

// ── Helper: Verificar token ─────────────────────────────────
async function verifyToken(token, secret) {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const payload = atob(payloadB64);
    const [, expStr] = payload.split("|");
    if (Math.floor(Date.now() / 1000) > parseInt(expStr)) return false;
    return sig === await hmacSign(secret, payload);
  } catch { return false; }
}

// ── Helper: Eliminar imagen de Cloudinary ──────────────────
async function destroyCloudinaryImage(env, publicId) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);

  const toSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const msgBuffer = new TextEncoder().encode(toSign);
  const hashBuffer = await crypto.subtle.digest("SHA-1", msgBuffer);
  const signature = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp.toString());
  form.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
    { method: "POST", body: form }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Cloudinary destroy error: ${res.status} ${errText}`);
  }
}