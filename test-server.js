// test-server.js – простой HTTP-сервер для проверки GSI
const http = require('http');

const server = http.createServer((req, res) => {
    console.log('📨 Получен запрос:', req.method, req.url);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        console.log('📦 Тело запроса:', body);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    });
});

server.listen(3000, () => {
    console.log('🟢 Тестовый сервер слушает порт 3000...');
});