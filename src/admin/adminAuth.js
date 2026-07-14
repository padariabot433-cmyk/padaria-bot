// Autenticação HTTP Basic simples (usuário fixo "padaria" + senha do .env).
// Protege a página de pedidos, já que a URL do Render é pública.
export function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    return res
      .status(500)
      .send('Defina a variável de ambiente ADMIN_PASSWORD para usar o painel.');
  }

  const header = req.headers.authorization || '';
  const [type, encoded] = header.split(' ');

  if (type === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [, pass] = decoded.split(':'); // usuário pode ser qualquer texto
    if (pass === password) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Painel da Padaria"');
  return res.status(401).send('Senha necessária para acessar o painel.');
}
