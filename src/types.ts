export type Company = {
  industry: string;
  subSector: string;
  company: string;
  brandOrCnName: string;
  countryOrRegion: string;
  primaryChinaCityFocus: string;
  cities: string[];
  recruitingUrl: string;
  rolesToWatch: string;
  benefitOrFilterTags: string;
  notes: string;
  benefits: string[];
  dataSource?: string;
  waiqiId?: string;
  waiqiSourceUrl?: string;
  waiqiPositionCount?: string;
  mergeStatus?: string;
  verifiedCareerUrl?: string;
  careerEnrichmentStatus?: string;
};

export type Job = {
  id: string;
  jobKey?: string;
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
