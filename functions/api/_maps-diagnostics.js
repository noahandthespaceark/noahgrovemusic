// Never return upstream messages, metadata, URLs, addresses, keys, or stack traces.
const statuses=new Set(['INVALID_ARGUMENT','PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','NOT_FOUND','UNAVAILABLE','INTERNAL','DEADLINE_EXCEEDED','FAILED_PRECONDITION']);
const reasons=new Set([
  'API_KEY_INVALID','API_KEY_EXPIRED','API_KEY_NOT_FOUND','API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','API_KEY_ANDROID_APP_BLOCKED',
  'API_KEY_IOS_APP_BLOCKED','SERVICE_DISABLED','BILLING_DISABLED','BILLING_NOT_ACTIVE',
  'CONSUMER_INVALID','CONSUMER_SUSPENDED','RATE_LIMIT_EXCEEDED','QUOTA_EXCEEDED',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT','CREDENTIALS_MISSING'
]);
const guidance={
  API_KEY_INVALID:'Google reports that this API key is invalid.',
  API_KEY_EXPIRED:'Google reports that this API key has expired.',
  API_KEY_NOT_FOUND:'Google could not find this API key.',
  API_KEY_SERVICE_BLOCKED:'The key does not permit the requested Google API.',
  API_KEY_HTTP_REFERRER_BLOCKED:'Browser-referrer restrictions are blocking this server-side request.',
  API_KEY_IP_ADDRESS_BLOCKED:'The server request is blocked by the key’s IP restrictions.',
  SERVICE_DISABLED:'The requested API is not enabled in the Google project associated with this key.',
  BILLING_DISABLED:'Google reports that billing is disabled for the associated project.',
  BILLING_NOT_ACTIVE:'Google reports that billing is not active for the associated project.',
  RATE_LIMIT_EXCEEDED:'Google reports a rate limit.',
  QUOTA_EXCEEDED:'Google reports an exhausted quota.'
};
export class MapsFailure extends Error{
  constructor(code,diagnostic){super(code);this.diagnostic=Object.freeze(diagnostic);}
}
export function failure(operation,stage,reason,extra={}){
  return new MapsFailure(reason==='KEY_NOT_CONFIGURED'?'MAPS_NOT_CONFIGURED':extra.httpStatus===403?'MAPS_ACCESS_DENIED':'MAPS_UNAVAILABLE',
    {version:1,operation,stage,reason,...extra});
}
export function providerFailure(operation,response,data){
  const error=data?.error;
  const providerStatus=statuses.has(error?.status)?error.status:'UNKNOWN';
  const reason=(Array.isArray(error?.details)?error.details:[])
    .filter(detail=>detail?.['@type']==='type.googleapis.com/google.rpc.ErrorInfo')
    .map(detail=>detail.reason).find(reason=>reasons.has(reason))||'UPSTREAM_HTTP_ERROR';
  return failure(operation,'google_response',reason,{httpStatus:response.status,providerStatus,
    explanation:guidance[reason]||'Google returned an error; raw details are withheld to protect private configuration.'});
}
export function diagnosticFor(error,operation){
  // Only our own allowlisted diagnostic objects may leave the server.
  return error instanceof MapsFailure?error.diagnostic:{version:1,operation,stage:'application',reason:'UNCLASSIFIED_APPLICATION_ERROR'};
}
export function transportFailure(operation,error){
  // Inspect messages only for fixed signatures; never return or log the message itself.
  const message=String(error?.message||'');
  const exceptionType=['TypeError','TimeoutError','AbortError','Error','NetworkError'].includes(error?.name)?error.name:'UnknownError';
  if(/redirect/i.test(message)&&/unsupported|not supported|invalid/i.test(message)){
    return failure(operation,'request_setup','UNSUPPORTED_REDIRECT_MODE',{exceptionType,
      explanation:'The deployed runtime rejects the redirect mode in this application’s outgoing request. The request fails before reaching Google.'});
  }
  if(/header|ByteString/i.test(message)&&/invalid|unsupported|convert|character/i.test(message)){
    return failure(operation,'request_setup','REQUEST_HEADERS_REJECTED',{exceptionType});
  }
  if(['TimeoutError','AbortError'].includes(error?.name))return failure(operation,'transport','REQUEST_TIMED_OUT',{exceptionType});
  const code=error?.cause?.code||error?.code;
  if(['ENOTFOUND','EAI_AGAIN'].includes(code))return failure(operation,'transport','DNS_LOOKUP_FAILED',{exceptionType});
  if(['ECONNRESET','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(code))return failure(operation,'transport','CONNECTION_FAILED',{exceptionType});
  return failure(operation,'transport','NETWORK_REQUEST_FAILED',{exceptionType});
}
