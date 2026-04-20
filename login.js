export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if(email === 'admin@midis.gob.pe' && password === 'AdminMIDIS2026!'){
      return Response.json({
        ok: true,
        token: 'token-demo',
        name: 'Administrador MIDIS',
        role: 'Administrador'
      });
    }

    return Response.json({ ok:false }, { status:401 });

  } catch(e){
    return Response.json({ ok:false, error:e.message });
  }
}