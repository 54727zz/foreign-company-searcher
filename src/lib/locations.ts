import type { Company, Job } from '../types';

export type ChinaRegion = {
  id: string;
  name: string;
  cities: string[];
  provinces: string[];
  shape: string;
};

export const chinaRegions: ChinaRegion[] = [
  { id: 'northeast', name: '东北', cities: ['大连', '沈阳', '长春', '哈尔滨', '佳木斯'], provinces: ['辽宁', '吉林', '黑龙江'], shape: 'M430 86 L552 62 L620 120 L586 220 L488 216 L438 160 Z' },
  { id: 'north', name: '华北', cities: ['北京', '天津', '石家庄', '济南', '青岛', '太原', '呼和浩特'], provinces: ['北京', '天津', '河北', '山东', '山西', '内蒙古'], shape: 'M318 142 L438 160 L488 216 L462 292 L342 286 L272 226 Z' },
  { id: 'east', name: '华东', cities: ['上海', '苏州', '杭州', '南京', '宁波', '无锡', '合肥', '厦门', '福州', '常州', '昆山', '太仓', '嘉兴', '南通', '张家港'], provinces: ['上海', '江苏', '浙江', '安徽', '福建'], shape: 'M462 292 L560 304 L600 408 L542 502 L440 462 L402 360 Z' },
  { id: 'central', name: '华中', cities: ['武汉', '长沙', '郑州', '洛阳', '南昌', '徐州'], provinces: ['湖北', '湖南', '河南', '江西'], shape: 'M342 286 L462 292 L440 462 L320 472 L258 378 Z' },
  { id: 'south', name: '华南', cities: ['深圳', '广州', '东莞', '佛山', '珠海', '惠州', '南宁', '海口'], provinces: ['广东', '广西', '海南'], shape: 'M320 472 L440 462 L542 502 L486 590 L354 604 L276 540 Z' },
  { id: 'southwest', name: '西南', cities: ['成都', '重庆', '贵阳', '昆明'], provinces: ['四川', '重庆', '贵州', '云南', '西藏'], shape: 'M148 328 L258 378 L320 472 L276 540 L126 560 L70 452 Z' },
  { id: 'northwest', name: '西北', cities: ['西安', 'XiAn', '兰州', '银川', '乌鲁木齐', '西宁'], provinces: ['陕西', 'Shaanxi', '甘肃', '宁夏', '新疆', '青海'], shape: 'M84 122 L318 142 L272 226 L342 286 L258 378 L148 328 L44 250 Z' },
];

export const cityAliases: Record<string, string> = {
  Shanghai: '上海',
  Beijing: '北京',
  Dalian: '大连',
  Shenzhen: '深圳',
  Guangzhou: '广州',
  Chengdu: '成都',
  XiAn: '西安',
  Xian: '西安',
  Suzhou: '苏州',
  Hangzhou: '杭州',
  Nanjing: '南京',
  Wuhan: '武汉',
  Changsha: '长沙',
  Zhengzhou: '郑州',
  Qingdao: '青岛',
  Wuxi: '无锡',
  Tianjin: '天津',
  Chongqing: '重庆',
  Xiamen: '厦门',
  Dongguan: '东莞',
  Foshan: '佛山',
  Ningbo: '宁波',
  Shaanxi: '陕西',
};

function normalizeLocationText(value: string): string {
  return Object.entries(cityAliases).reduce((text, [alias, city]) => text.replace(new RegExp(alias, 'gi'), city), value);
}

export function regionsForText(value: string): ChinaRegion[] {
  const normalized = normalizeLocationText(value);
  return chinaRegions.filter((region) =>
    [...region.cities, ...region.provinces].some((item) => normalized.includes(item)),
  );
}

export function companyMatchesRegion(company: Company, regionId: string): boolean {
  const region = chinaRegions.find((item) => item.id === regionId);
  if (!region) return true;
  return regionsForText(company.primaryChinaCityFocus).some((item) => item.id === region.id);
}

export function jobMatchesRegion(job: Job, regionId: string): boolean {
  const region = chinaRegions.find((item) => item.id === regionId);
  if (!region) return true;
  return regionsForText(`${job.city} ${job.location}`).some((item) => item.id === region.id);
}

export function topCitiesForRegion(companies: Company[], jobs: Job[], regionId: string): Array<[string, number]> {
  const region = chinaRegions.find((item) => item.id === regionId);
  if (!region) return [];
  return region.cities
    .map((city) => {
      const companyCount = companies.filter((company) => normalizeLocationText(company.primaryChinaCityFocus).includes(city)).length;
      const jobCount = jobs.filter((job) => normalizeLocationText(`${job.city} ${job.location}`).includes(city)).length;
      return [city, companyCount + jobCount] as [string, number];
    })
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
}
