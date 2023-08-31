import { API_BASE } from './constants';

const paths = {
  root: function () {
    return '/';
  },
  signIn: function () {
    return '/auth/sign-in';
  },
  signUp: function () {
    return '/auth/sign-up';
  },
  get home() {
    return this.root;
  },
  systemSetup: function () {
    return '/system-setup';
  },
  onboarding: {
    orgName: function () {
      return '/onboarding';
    },
    security: function ({ slug }: { slug: string }) {
      return `/onboarding/${slug}/security`;
    },
    roles: function ({ slug }: { slug: string }) {
      return `/onboarding/${slug}/roles`;
    },
  },
  settings: function () {
    return '/system-settings';
  },
  users: function () {
    return '/users';
  },
  dashboard: function () {
    return '/dashboard';
  },
  organization: function ({ slug }: { slug: string }) {
    return `/dashboard/${slug}`;
  },
  organizationSettings: function ({ slug }: { slug: string }) {
    return `/dashboard/${slug}/settings`;
  },
  workspace: function (slug: string, workspaceSlug: string) {
    return `/dashboard/${slug}/workspace/${workspaceSlug}`;
  },
  document: function (slug: string, workspaceSlug: string, docId: string) {
    return `/dashboard/${slug}/workspace/${workspaceSlug}/document/${docId}`;
  },
  jobs: function ({ slug }: { slug: string }) {
    return `/dashboard/${slug}/jobs`;
  },
  debug: {
    vdbms: function () {
      const { origin } = getServerUrl();
      return `${origin}/api/debug/vdbms/login`;
    },
    jobs: function () {
      const { origin } = getServerUrl();
      return `${origin}/api/debug/jobs/login`;
    },
  },
};

function getServerUrl() {
  try {
    return new URL(API_BASE);
  } catch {
    return new URL(window.location.origin);
  }
}

export default paths;
