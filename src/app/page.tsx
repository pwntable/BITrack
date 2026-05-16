'use client';

import { useCurriculumStore } from '@/store/curriculumStore';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { Dashboard } from '@/components/Dashboard';
import { useEffect, useState } from 'react';

export default function Home() {
  const { activeCurriculumId, getActiveCurriculum } = useCurriculumStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Avoid hydration mismatch
  if (!mounted) {
    return <div className="min-h-screen bg-background animate-pulse" />;
  }

  const hasActiveCurriculum = !!activeCurriculumId && !!getActiveCurriculum();

  return hasActiveCurriculum ? <Dashboard /> : <OnboardingFlow />;
}
