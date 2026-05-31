/** Baidu 站长验证：直接 200 返回，避免 Pages Pretty URL 308 去掉 .html 后缀 */
const BAIDU_VERIFY = '51ce6e99cdb1d30c565e2b090b406c4c';

export async function onRequest() {
  return new Response(BAIDU_VERIFY, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
