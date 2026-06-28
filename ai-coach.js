const constants = require('dotaconstants');
const openDotaService = require('./opendota-service');
const axios = require('axios');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class AICoach {
    constructor() {
        this.heroes = constants.heroes;
        this.items = constants.items;
        this.abilities = constants.abilities;
        this.patch = constants.patch;
        console.log(`✅ Загружены данные для патча ${this.patch.current}`);
    }

    getHeroInfo(heroId) {
        for (let heroKey in this.heroes) {
            if (this.heroes[heroKey].id === heroId) return this.heroes[heroKey];
        }
        return null;
    }

    extractEnemyHeroes(gameState) {
        const enemies = [];
        if (gameState.players) {
            const myTeam = gameState.player?.team;
            for (let playerId in gameState.players) {
                const player = gameState.players[playerId];
                if (player.team !== myTeam && player.hero_id) enemies.push(player.hero_id);
            }
        }
        return enemies;
    }

    async generateContext(heroData, gameState) {
        const heroId = heroData.id || heroData.hero_id;
        const heroInfo = this.getHeroInfo(heroId);
        if (!heroInfo) return null;

        const enemyHeroIds = this.extractEnemyHeroes(gameState);
        const matchupData = enemyHeroIds.length ? await openDotaService.getHeroMatchups(heroId) : null;
        const itemPopularity = await openDotaService.getHeroItemPopularity(heroId, enemyHeroIds);

        // Текущие предметы
        const currentItemNames = [];
        if (gameState.items) {
            Object.values(gameState.items).forEach(item => {
                if (item && item.name && item.name !== 'empty') {
                    currentItemNames.push(item.name.replace('item_', ''));
                }
            });
        }

        return {
            hero: {
                id: heroId,
                name: heroInfo.localized_name,
                primary_attr: heroInfo.primary_attr,
                attack_type: heroInfo.attack_type,
                roles: heroInfo.roles
            },
            gameTime: gameState.map?.game_time || 0,
            gold: heroData.gold || 0,
            currentItems: currentItemNames,
            enemies: enemyHeroIds.map(id => this.getHeroInfo(id)).filter(Boolean),
            matchups: matchupData ? matchupData.filter(m => enemyHeroIds.includes(m.hero_id)) : [],
            recommendedItems: itemPopularity
        };
    }

    buildPrompt(context) {
        const hero = context.hero;
        const gameTime = context.gameTime;
        const minutes = Math.floor(gameTime / 60);
        const seconds = gameTime % 60;
        const gold = context.gold;
        const items = context.currentItems.length ? context.currentItems.join(', ') : 'нет';
        const heroRole = hero.roles[0] || 'unknown';

        // Формируем список врагов с их основными угрозами
        let enemyAnalysis = '';
        if (context.enemies.length > 0) {
            enemyAnalysis = context.enemies.map(e => {
                let threat = '';
                // Определяем тип угрозы на основе ролей и атрибутов
                if (e.roles.includes('Carry') || e.roles.includes('Escape')) threat = 'физический керри с уклонением';
                else if (e.roles.includes('Nuker') || e.primary_attr === 'int') threat = 'магический нукер';
                else if (e.roles.includes('Initiator') || e.roles.includes('Disabler')) threat = 'инициатор с контролем';
                else threat = 'опасный герой';
                return `${e.localized_name} (${threat})`;
            }).join('; ');
        } else {
            enemyAnalysis = 'неизвестны (играй по ситуации)';
        }

        const prompt = `Ты — профессиональный аналитик и тренер по Dota 2 с рейтингом 9000+ MMR. 
Твоя задача — дать максимально конкретный и полезный совет игроку, который хочет выиграть текущий матч. 
Используй знания меты патча ${this.patch.current}, контрпиков, таймингов предметов и стратегий.

### ТЕКУЩАЯ СИТУАЦИЯ:
- Герой: **${hero.name}** (роль: ${heroRole}, тип атаки: ${hero.attack_type}, основной атрибут: ${hero.primary_attr})
- Время игры: **${minutes}:${seconds.toString().padStart(2, '0')}**
- Золото: **${gold}**
- Текущие предметы: **${items}**
- Враги: **${enemyAnalysis}**

### ЗАДАЧА:
1. Проанализируй вражеский состав. Определи:
   - Есть ли у врагов сильный магический урон? (если да, нужен BKB, Pipe, Glimmer)
   - Есть ли физические керри с высоким burst-уроном? (нужен Ghost, Halberd, Shiva)
   - Есть ли герои с уклонением/уворотами? (нужен MKB, Bloodthorn)
   - Есть ли герои с сильным контролем? (нужен BKB, Linken, Lotus)
   - Есть ли герои, которые зависят от иллюзий? (нужен AOE-урон, Crimson, Radiance)
   - Есть ли герои, которые любят стоять и бить? (нужен Heaven's Halberd, Blade Mail)

2. С учетом твоего героя, его текущих предметов и фазы игры, дай **конкретные советы** в формате JSON.

### ТРЕБОВАНИЯ К ОТВЕТУ:
- "advice": общий совет по стратегии на ближайшие 3-5 минут (одно предложение, максимум 120 символов). Что делать прямо сейчас: давить, фармить, стоять, рошан, пушить, защищаться?
- "farming": конкретное место для фарма ("лес", "линия бота", "треугольник у рошана", "агрессивный лес врага", "безопасная зона"). Если герой не фармер, укажи "ищи файты".
- "nextItem": **конкретный предмет**, который нужно купить следующим. Только название, например: "Black King Bar", "Ghost Scepter", "Aghanim's Scepter".
- "itemReason": почему именно этот предмет нужен против этих врагов (одно предложение, учитывай контрпики).

### ПРИМЕРЫ ХОРОШИХ ОТВЕТОВ:

Пример 1 (керри против магов):
{
  "advice": "Фарми треугольник, не участвуй в драках пока не соберешь BKB. Враги имеют 3 мага.",
  "farming": "Треугольник у рошана",
  "nextItem": "Black King Bar",
  "itemReason": "Против Invoker, Lion и Zeus BKB даст иммунитет к их контролю и магическому урону"
}

Пример 2 (саппорт против физиков):
{
  "advice": "Стоять за керри, ставить варды на вход в лес. У врага PA и Ursa.",
  "farming": "Ищи файты, не фарми",
  "nextItem": "Ghost Scepter",
  "itemReason": "Ghost Scepter спасет от физического burst'а PA и Ursa, позволит дожить до прихода тиммейтов"
}

Пример 3 (мидер против уворотливых):
{
  "advice": "Провоцируй драки, когда ульта готова. У врага Puck и QoP, они любят убегать.",
  "farming": "Линия мид, затем ганк на боковые",
  "nextItem": "Orchid Malevolence",
  "itemReason": "Orchid заサイленсит Puck и QoP, не давая им использовать увороты"
}

Пример 4 (оффлейн против иллюзий):
{
  "advice": "Ищи драки, используй Blade Mail против их керри. У врага PL и Chaos Knight.",
  "farming": "Лес врага",
  "nextItem": "Crimson Guard",
  "itemReason": "Crimson Guard снижает урон от иллюзий и спасает команду в драках"
}

Теперь сгенерируй ответ для текущей ситуации. Отвечай ТОЛЬКО JSON, без пояснений.`;

        return prompt;
    }

    async callLLM(prompt) {
        const GIGACHAT_BASIC_AUTH = process.env.GIGACHAT_BASIC_AUTH || 'MDE5Y2FhODUtNzM4Yi03ODk1LTk5ZTItYzllODgzYjlhOGMyOjRiODI1N2ZjLTNjYzItNGYzNi04M2I4LTI4NzA3ZjY4N2MyMQ==';
        if (!GIGACHAT_BASIC_AUTH) {
            console.error('❌ GIGACHAT_BASIC_AUTH не установлен');
            return this.getFallbackAdvice();
        }

        const agent = new https.Agent({ rejectUnauthorized: false });

        try {
            // 1. Получаем токен
            const tokenResponse = await axios.post(
                'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
                'scope=GIGACHAT_API_PERS',
                {
                    httpsAgent: agent,
                    headers: {
                        'Authorization': `Basic ${GIGACHAT_BASIC_AUTH}`,
                        'RqUID': uuidv4(),
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            const accessToken = tokenResponse.data.access_token;

            // 2. Запрос к GigaChat
            const response = await axios.post(
                'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
                {
                    model: 'GigaChat',
                    messages: [
                        { role: 'system', content: 'Ты эксперт по Dota 2. Отвечай только в JSON формате.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.8,
                    max_tokens: 600,
                    top_p: 0.9
                },
                {
                    httpsAgent: agent,
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const content = response.data.choices[0].message.content;
            console.log('📨 Сырой ответ GigaChat:', content);

            // Извлекаем JSON
            let jsonStr = content;
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }

            const parsed = JSON.parse(jsonStr);
            console.log('✅ Распарсенный JSON:', parsed);
            return parsed;
        } catch (error) {
            console.error('❌ Ошибка при вызове GigaChat:', error.message);
            if (error.response) {
                console.error('Статус:', error.response.status);
                console.error('Данные:', error.response.data);
            }
            return this.getFallbackAdvice();
        }
    }

    getFallbackAdvice() {
        console.log('⚠️ Используется запасной совет (fallback)');
        return {
            advice: "Играй по ситуации, смотри на карту",
            farming: "Безопасные зоны",
            nextItem: "BKB",
            itemReason: "Универсальная защита от контроля"
        };
    }

    async generateAdvice(heroData, gameState) {
        try {
            const context = await this.generateContext(heroData, gameState);
            if (!context) return null;
            const prompt = this.buildPrompt(context);
            console.log('📤 Промпт (первые 500 символов):', prompt.substring(0, 500) + '...');
            const aiResponse = await this.callLLM(prompt);
            let finalAdvice = aiResponse.advice || '';
            if (aiResponse.farming) {
                finalAdvice += ` | Фарм: ${aiResponse.farming}`;
            }
            if (aiResponse.nextItem) {
                finalAdvice += ` | Купи ${aiResponse.nextItem}: ${aiResponse.itemReason}`;
            }
            return finalAdvice;
        } catch (error) {
            console.error('❌ Ошибка в generateAdvice:', error);
            return null;
        }
    }
}

module.exports = new AICoach();