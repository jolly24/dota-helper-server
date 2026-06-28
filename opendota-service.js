const axios = require('axios');

class OpenDotaService {
  constructor() {
    this.baseUrl = 'https://api.opendota.com/api';
  }

  // Получение статистики матчапов для героя
  async getHeroMatchups(heroId) {
    try {
      // Важно: соблюдаем лимит запросов (не более 1 в секунду)
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const response = await axios.get(`${this.baseUrl}/heroes/${heroId}/matchups`);
      return response.data;
    } catch (error) {
      console.error('Ошибка при запросе к OpenDota:', error.message);
      return null;
    }
  }

  // Получение популярных предметов для героя против конкретных врагов
  async getHeroItemPopularity(heroId, enemyHeroIds = []) {
    try {
      const response = await axios.get(`${this.baseUrl}/heroes/${heroId}/itemPopularity`);
      const itemData = response.data;
      
      return {
        startGameItems: itemData.start_game_items,
        earlyGameItems: itemData.early_game_items,
        midGameItems: itemData.mid_game_items,
        lateGameItems: itemData.late_game_items
      };
    } catch (error) {
      console.error('Ошибка при запросе популярности предметов:', error.message);
      return null;
    }
  }

  // Поиск героя по имени (для получения ID)
  async getHeroIdByName(heroName) {
    try {
      const response = await axios.get(`${this.baseUrl}/heroes`);
      const heroes = response.data;
      
      const cleanName = heroName.replace('npc_dota_hero_', '').toLowerCase();
      
      const hero = heroes.find(h => 
        h.name.toLowerCase().includes(cleanName) || 
        h.localized_name.toLowerCase() === cleanName
      );
      
      return hero ? hero.id : null;
    } catch (error) {
      console.error('Ошибка при поиске героя:', error.message);
      return null;
    }
  }
}

module.exports = new OpenDotaService();