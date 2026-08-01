export type Company = {
  industry: string;
  subSector: string;
  company: string;
  brandOrCnName: string;
  countryOrRegion: string;
  primaryChinaCityFocus: string;
  recruitingUrl: string;
  rolesToWatch: string;
  benefitOrFilterTags: string;
  notes: string;
  benefits: string[];
};

export type Job = {
  id: string;
  company: string;
  title: string;
  city: string;
  location: string;
  sourcePlatform: string;
  sourceUrl: string;
  searchUrl: string;
  scrapedAt: string;
  status: string;
};

export type JobFeed = {
  company: string;
  sourceUrl: string;
  scrapedAt: string;
  count: number;
  scope?: string;
  cityCounts?: Record<string, number>;
  jobs: Job[];
};
