require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// La ruta de inicio (esta sí te funcionó)
app.get('/', (req, res) => {
    res.send('¡El servidor de lockerApp está funcionando a la perfección!');
});

// NUEVA RUTA: Obtener todos los lockers (Conectada a la nueva tabla)
app.get('/api/lockers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contratos_firmados')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      return res.status(400).json({ mensaje: "Error al obtener lockers: " + error.message });
    }

    res.json(data);

  } catch (error) {
    res.status(500).json({ mensaje: "Error interno del servidor." });
  }
});
const PORT = process.env.PORT || 3000;

// RUTA: REGISTRAR (Ahora guarda el nombre en Supabase)
app.post('/api/registrar', async (req, res) => {
  const { nombre, correo, pin } = req.body;
  try {
    const pinEncriptado = await bcrypt.hash(pin, 10);
    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre: nombre, correo: correo, pin: pinEncriptado }]);

    if (error) return res.status(400).json({ mensaje: "Error: " + error.message });
    res.json({ mensaje: "¡Usuario registrado con éxito!" });
  } catch (error) {
    res.status(500).json({ mensaje: "Error del servidor." });
  }
});

// RUTA: LOGIN (Ahora devuelve el nombre a la app)
app.post('/api/abrir', async (req, res) => {
  const { correo, pin } = req.body;
  try {
    // Buscamos al usuario por correo
    const { data, error } = await supabase.from('usuarios').select('*').eq('correo', correo).single();
    
    if (error || !data) return res.status(400).json({ mensaje: "Usuario no encontrado." });

    // Comparamos el PIN
    const pinValido = await bcrypt.compare(pin, data.pin);
    if (!pinValido) return res.status(400).json({ mensaje: "PIN incorrecto." });

    // ¡Éxito! Devolvemos TODOS los datos importantes del estudiante a la app
    res.json({ 
      mensaje: "Acceso concedido", 
      nombre: data.nombre,
      carrera: data.carrera || "", // Reemplaza con el nombre real de tu columna en Supabase si es distinto
      universidad: data.universidad || "",
      id_locker: data.id_locker || null // ¡Súper importante! Pon el nombre exacto de la columna donde guardas su locker
    });
  } catch (error) {
    res.status(500).json({ mensaje: "Error del servidor." });
  }
});
// RUTA: EDITAR PERFIL (Guardar nueva carrera y sede)
app.put('/api/editar', async (req, res) => {
  const { correo, carrera, universidad } = req.body;
  
  try {
    // Actualizamos los datos en Supabase buscando al usuario por su correo
    const { error } = await supabase
      .from('usuarios') // Asegúrate de que tu tabla se llame 'usuarios'
      .update({ carrera, universidad })
      .eq('correo', correo);

    if (error) {
      return res.status(400).json({ mensaje: "Error al actualizar en la base de datos." });
    }

    res.json({ mensaje: "Perfil actualizado con éxito." });
  } catch (error) {
    res.status(500).json({ mensaje: "Error del servidor." });
  }
});
// RUTA: GUARDAR RESERVA DEL CASILLERO
app.post('/api/reservar', async (req, res) => {
  const { correo, id_locker } = req.body;
  try {
    const { error } = await supabase
      .from('usuarios')
      .update({ id_locker: id_locker }) // <- IMPORTANTE: que coincida con tu columna en Supabase
      .eq('correo', correo);

    if (error) {
      console.log("Error de Supabase:", error); // Esto nos dejará verlo en Render
      return res.status(400).json({ mensaje: "Error al guardar casillero." });
    }
    res.json({ mensaje: "Reserva guardada en la nube con éxito." });
  } catch (error) {
    res.status(500).json({ mensaje: "Error del servidor." });
  }
});
// RUTA: FIRMAR CONTRATO Y RESERVAR CASILLERO (FEUST 2026-2027)
app.post('/api/firmar_contrato', async (req, res) => {
  // 1. AHORA RECIBIMOS TAMBIÉN EL COMPROBANTE
  const { rut, correo, torre, piso, n_casillero, firmaBase64, comprobanteBase64 } = req.body; 

  try {
    // --- PASO A: PROCESAR Y SUBIR LA FIRMA ---
    const base64Firma = firmaBase64.replace(/^data:image\/\w+;base64,/, "");
    const firmaBuffer = Buffer.from(base64Firma, 'base64');
    const nombreFirma = `firma_${rut}_${Date.now()}.png`;

    const { error: uploadFirmaError } = await supabase
      .storage
      .from('firmas_contratos')
      .upload(nombreFirma, firmaBuffer, { contentType: 'image/png', upsert: false });

    if (uploadFirmaError) {
      console.log("Error Storage Firma:", uploadFirmaError);
      return res.status(400).json({ mensaje: "No se pudo subir la firma." });
    }

    const { data: urlFirmaData } = supabase.storage.from('firmas_contratos').getPublicUrl(nombreFirma);
    const firmaUrl = urlFirmaData.publicUrl;

    // --- PASO B: PROCESAR Y SUBIR EL COMPROBANTE (NUEVO) ---
    let comprobanteUrl = null;
    if (comprobanteBase64) {
      const base64Comprobante = comprobanteBase64.replace(/^data:image\/\w+;base64,/, "");
      const comprobanteBuffer = Buffer.from(base64Comprobante, 'base64');
      const nombreComprobante = `comprobante_${rut}_${Date.now()}.jpg`;

      // Subimos la foto al cajón 'comprobantes'
      const { error: uploadComprobanteError } = await supabase
        .storage
        .from('comprobantes') 
        .upload(nombreComprobante, comprobanteBuffer, { contentType: 'image/jpeg', upsert: false });

      if (uploadComprobanteError) {
        console.log("Error Storage Comprobante:", uploadComprobanteError);
        return res.status(400).json({ mensaje: "No se pudo subir el comprobante de pago." });
      }

      const { data: urlComprobanteData } = supabase.storage.from('comprobantes').getPublicUrl(nombreComprobante);
      comprobanteUrl = urlComprobanteData.publicUrl;
    }

    // --- PASO C: GUARDAR TODO EL CONTRATO LEGAL EN SUPABASE ---
    const { error: dbError } = await supabase
      .from('contratos_firmados')
      .insert([{
        rut: rut,
        correo: correo,
        torre: torre,
        piso: piso,
        n_casillero: n_casillero,
        firma_url: firmaUrl,
        comprobante_url: comprobanteUrl, // <-- AHORA SÍ GUARDAMOS EL LINK DE LA FOTO
        monto_pagado: 10000,
        periodo: "2026-2027",
        fecha_firma: new Date().toISOString()
      }]);

    if (dbError) {
      console.log("Error BD:", dbError);
      return res.status(400).json({ mensaje: "Error al guardar el contrato legal." });
    }

    // --- PASO D: ASIGNAR EL CASILLERO EN LA TABLA USUARIOS ---
    await supabase.from('usuarios').update({ id_locker: n_casillero }).eq('correo', correo);

    // ¡Éxito total!
    res.json({ 
      mensaje: "Contrato firmado y casillero reservado con éxito.", 
      url_documento: firmaUrl 
    });

  } catch (error) {
    console.error("Error crítico en el servidor:", error);
    res.status(500).json({ mensaje: "Error interno del servidor." });
  }
});
app.post('/api/liberar', async (req, res) => {
  const { id_locker, correo } = req.body;

  try {
    // 1. Buscamos el locker y lo marcamos como disponible
    const { error: errorLocker } = await supabase
      .from('lockers')
      // OJO: Si tu columna en Supabase se llama "estado", cambia "ocupado: false" por "estado: 'disponible'"
     .update({ estado: 'disponible', usuario_correo: null, reserved_at: null })
      .eq('id', id_locker);

    if (errorLocker) throw errorLocker;

    // ¡EL PASO CLAVE! Le avisamos a la app móvil que todo salió perfecto
    res.status(200).json({ mensaje: "Locker liberado con éxito" });

  } catch (error) {
    // Si algo sale mal, lo imprimimos en Render para verlo y le avisamos a la app
    console.error("🔥 Error al liberar locker:", error);
    res.status(500).json({ mensaje: "Error del servidor", detalle: error.message });
  }
});
// --- RUTA EXCLUSIVA PARA EL PANEL DE EVALUACIÓN ---
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    // Le pedimos a Supabase TODA la tabla de reservas
    // IMPORTANTE: Si tu tabla se llama distinto (ej: 'usuarios' o 'lockers'), cámbialo aquí.
    const { data, error } = await supabase
      .from('contratos_firmados') 
      .select('*')
      .order('fecha_firma', { ascending: false }); // Ordena de más nuevo a más viejo

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data); // Enviamos los datos listos a la web
  } catch (error) {
    console.error("Error cargando dashboard:", error);
    res.status(500).json({ error: "No se pudieron cargar los datos del panel" });
  }
});
// 🛠️ RUTA 1: Recibir reporte desde el celular
app.post('/api/reportar_falla', async (req, res) => {
  const { correo, id_locker, mensaje } = req.body;

  // Insertamos el reporte en la tabla historial_accesos de Supabase
  const { data, error } = await supabase
    .from('reportes_fallas')
    .insert([
      { 
        correo: correo, 
        accion: `FALLA EN LOCKER #${id_locker}: ${mensaje}`,
        fecha: new Date().toISOString()
      }
    ]);

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ mensaje: "Reporte guardado con éxito en la nube" });
});

// 🛠️ RUTA 2: Obtener todos los reportes para el Dashboard del profesor
app.get('/api/ver_reportes', async (req, res) => {
  const { data, error } = await supabase
    .from('reportes_fallas')
    .select('*')
    .ilike('accion', '%FALLA%') // Filtra solo las acciones que contengan la palabra "FALLA"
    .order('id', { ascending: false });

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
});
// 🛠️ RUTA 3: Marcar problema como solucionado desde el Dashboard
app.post('/api/resolver_falla', async (req, res) => {
  const { correo } = req.body;
  
  // Borra el reporte de la tabla de fallas
  const { error } = await supabase
    .from('reportes_fallas')
    .delete()
    .match({ correo: correo });

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ mensaje: "Problema resuelto exitosamente" });
});
// Encendemos el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});