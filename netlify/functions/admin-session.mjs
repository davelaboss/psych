import {createAdminSession,readAdminSession,revokeAdminSession} from './_shared/admin-sessions.mjs';
import {jsonResponse} from './_shared/commerce.mjs';

export default async function handler(request) {
  try {
    if(request.method==='GET'){
      const session=await readAdminSession(request);
      return session?jsonResponse({ok:true,session}):jsonResponse({error:'Acceso no autorizado.'},401);
    }
    if(request.method!=='POST')return jsonResponse({error:'Método no permitido.'},405);
    const body=await request.json();
    if(['logout','revoke-all'].includes(body.action)){
      const cookie=await revokeAdminSession(request,{all:body.action==='revoke-all'});
      const response=jsonResponse({ok:true});response.headers.set('set-cookie',cookie);return response;
    }
    if(body.action!=='login')return jsonResponse({error:'Acción no válida.'},400);
    const {cookie,session}=await createAdminSession(request,body);
    const response=jsonResponse({ok:true,session});response.headers.set('set-cookie',cookie);return response;
  }catch(error){
    return jsonResponse({error:error.status?error.message:'No se pudo comprobar la sesión. Intentá nuevamente.'},Number(error.status||503));
  }
}
