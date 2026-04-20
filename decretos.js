export async function onRequestGet({ env }) {
  return Response.json({
    ok:true,
    decretos: [],
    acciones: []
  });
}