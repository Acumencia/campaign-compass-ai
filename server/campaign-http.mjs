import {randomBytes, createHash} from 'node:crypto';
import {createCampaignService} from './campaign.mjs';
import {loadTrails} from './trails.mjs';
import {createEvidenceTools} from './evidence-mcp-client.mjs';

// Local browser capability, not an account login. Never accept an owner in JSON.
const ownerCookie = 'cc_campaign_workspace';
export function createCampaignHTTP({directory, service, evidenceTools} = {}) {
  let campaigns = service;
  let tools=evidenceTools;
  const handle = async function ({name, req, res, session, ensureSession, sameOrigin, csrf, readJSON, json, generator,retrieveBrand,campaignDefaults=null,readiness=()=>({configured:false,consent:false})}) {
    if (name !== 'api/campaign' && !name.startsWith('api/campaign/')) return false;
    try {
      if (!sameOrigin(req)) throw Object.assign(new Error('Use the local application origin.'), {status:403,code:'cross_origin'});
      const raw = (req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(ownerCookie+'='))?.slice(ownerCookie.length+1);
      let capability = /^[a-f0-9]{64}$/.test(raw || '') ? raw : null;
      if(name==='api/campaign' && req.method==='GET') {
        session = ensureSession();
        if(!capability) {
          capability=randomBytes(32).toString('hex');
          const previous=res.getHeader('Set-Cookie');
          res.setHeader('Set-Cookie',[...(previous?[previous].flat():[]),`${ownerCookie}=${capability}; HttpOnly; SameSite=Strict; Path=/api/campaign; Max-Age=2592000`]);
        }
      }
      if(!capability || !session) throw Object.assign(new Error('Open the campaign workspace to resume this browser’s saved work.'),{status:403,code:'workspace_required'});
      const owner=createHash('sha256').update(capability).digest('hex');
      if(!campaigns){tools ||= createEvidenceTools();campaigns=createCampaignService({directory,evidenceTools:tools,modelTimeoutMs:60000});}
      if(name==='api/campaign' && req.method==='GET') {
        json(res,200,{csrf:session.csrf,runs:await campaigns.list(owner),catalog:await loadTrails(),readiness:readiness(),campaignDefaults,scope:'This browser’s local workspace. Clearing cookies removes access; this is not an account login.'});return true;
      }
      if(name==='api/campaign/trails' && req.method==='GET') {json(res,200,await loadTrails());return true;}
      if(req.method==='GET' && /^api\/campaign\/[a-zA-Z0-9-]+$/.test(name)) {json(res,200,await campaigns.get(owner,name.split('/')[2]));return true;}
      if(req.method!=='POST') throw Object.assign(new Error('Use a supported campaign action.'),{status:405,code:'method_not_allowed'});
      csrf(session,req.headers['x-cc-csrf']);
      const body=await readJSON(req);
      if(!body || typeof body!=='object' || Array.isArray(body)) throw Object.assign(new Error('Use a JSON action object.'),{status:400,code:'invalid_request'});
      const parts=name.split('/'),id=parts[2],action=parts[3];
      if((id==='create' && parts.length!==3) || (id!=='create' && parts.length!==4)) throw Object.assign(new Error('Unknown campaign action.'),{status:404,code:'not_found'});
      const keys=id==='create'?(Object.hasOwn(body,'mode')?['brief','mode']:['brief']):action==='edit'?['artifactId','text','expectedVersion']:action==='decide'?(['accept_revision','reject_revision'].includes(body.decision)?['decision','proposalId','expectedVersion']:['decision','expectedVersion']):action==='brief'?['brief','expectedVersion']:['expectedVersion'];
      if(Object.keys(body).some(k=>!keys.includes(k)) || keys.some(k=>!Object.hasOwn(body,k))) throw Object.assign(new Error('Unsupported campaign action fields.'),{status:400,code:'invalid_request'});
      let result;
      if(id==='create' && parts.length===3) result=await campaigns.create(owner,body.brief,{mode:body.mode||'offline-template'});
      else if(action==='advance') result=await campaigns.advance(owner,id,{...body,generator,retrieveBrand});
      else if(action==='edit') result=await campaigns.edit(owner,id,body);
      else if(action==='decide') result=await campaigns.decide(owner,id,{...body,generator});
      else if(action==='brief') result=await campaigns.updateBrief(owner,id,body);
      else if(action==='review') result=await campaigns.review(owner,id,{...body,generator});
      else if(action==='revise') result=await campaigns.revise(owner,id,{...body,generator});
      else if(action==='export') result=await campaigns.exportBundle(owner,id,body);
      else throw Object.assign(new Error('Unknown campaign action.'),{status:404,code:'not_found'});
      json(res,200,result);
    } catch(error) {
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:500;
      json(res,status,{error:{code:status===500?'campaign_unavailable':error.code||'campaign_error',message:status===500?'Campaign operation failed. Saved work is retained; refresh and resume.':error.message}});
    }
    return true;
  };
  handle.close=()=>{campaigns?.close?.();tools?.close?.();};
  return handle;
}
