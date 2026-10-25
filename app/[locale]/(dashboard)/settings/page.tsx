'use client';

import { DeleteAccountCard } from '@/components/features/account/delete-account-card';
import { NotificationSettings } from '@/components/features/notifications/notification-settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Divider, Text, Title } from '@/components/ui/metric';
import { authClient } from '@/lib/auth/client';
import { Calendar, CheckCircle, Key, Lock, Mail, Save, Shield, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * The code better-auth answers a wrong current password with on /change-password (400). Checked by
 * code, not by message: other failures say "invalid" too (an origin it does not trust is
 * "Invalid origin"), and those are not about the current password. `$ERROR_CODES` is used only as a
 * type: at runtime the react client answers `authClient.$ERROR_CODES.X` with a function, not a code
 */
const WRONG_CURRENT_PASSWORD = 'INVALID_PASSWORD' satisfies keyof typeof authClient.$ERROR_CODES;

/**
 * Personal settings: profile, password, notifications of the current organization and account
 * deletion (#164)
 */
export default function SettingsPage() {
  const t = useTranslations('settings.profile');
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;

  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Initialize form with user data
  useEffect(() => {
    if (user?.name) {
      setName(user.name);
    }
  }, [user?.name]);

  const handleNameChange = (value: string) => {
    setName(value);
    setHasChanges(value !== user?.name);
  };

  const handleSaveProfile = async () => {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }

    setIsSaving(true);
    try {
      const result = await authClient.updateUser({
        name: name.trim(),
      });

      if (result.error) {
        toast.error(t('saveError'));
        return;
      }

      toast.success(t('saveSuccess'));
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error(t('saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    // Validation
    if (!currentPassword) {
      toast.error(t('currentPasswordRequired'));
      return;
    }
    if (!newPassword) {
      toast.error(t('newPasswordRequired'));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t('passwordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordMismatch'));
      return;
    }

    setIsChangingPassword(true);
    try {
      /**
       * Always ends the user's other sessions (owner's decision, #591), like a reset does (#529).
       * better-auth (1.6.33) deletes every session of the user and signs this browser in again
       * with a new session cookie; called through the client (not $fetch), it then reloads the
       * session, so this tab stays signed in and holds the new session.
       */
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });

      if (result.error) {
        if (result.error.code === WRONG_CURRENT_PASSWORD) {
          toast.error(t('currentPasswordIncorrect'));
        } else {
          toast.error(t('passwordChangeError'));
        }
        return;
      }

      toast.success(t('passwordChangeSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Failed to change password:', error);
      toast.error(t('passwordChangeError'));
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (isPending) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
          <Card className="p-6">
            <div className="space-y-6">
              <div className="h-20 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
              <div className="h-20 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <Text className="mt-1">{t('pageDescription')}</Text>
        </div>

        {/* Profile Card */}
        <Card decoration="top" decorationColor="blue">
          <div className="p-6">
            {/* Profile Header */}
            <div className="flex items-start justify-between pb-6">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 bg-gradient-to-br from-blue-100 to-violet-100 dark:from-blue-900/30 dark:to-violet-900/30 rounded-xl flex items-center justify-center">
                  <User className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <Title>{user?.name || 'User'}</Title>
                  <div className="flex gap-2 mt-1">
                    <Badge color="blue">{user?.email}</Badge>
                    {user?.emailVerified ? (
                      <Badge color="emerald">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        {t('verified')}
                      </Badge>
                    ) : (
                      <Badge color="yellow">{t('notVerified')}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Divider />

            <div className="space-y-6 pt-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                {t('profileSection')}
              </h2>

              {/* Name Field */}
              <div className="space-y-2">
                <Label htmlFor="name" className="flex items-center gap-2">
                  <User className="h-4 w-4 text-gray-500" />
                  {t('nameLabel')}
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  disabled={isSaving}
                  aria-describedby="name-help"
                />
                <Text id="name-help" className="text-xs">
                  {t('nameHelp')}
                </Text>
              </div>

              {/* Email Field (Read-only) */}
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-500" />
                  {t('emailLabel')}
                </Label>
                <Input
                  id="email"
                  value={user?.email || ''}
                  disabled
                  className="bg-gray-50 dark:bg-gray-800"
                />
                <Text className="text-xs">{t('emailHelp')}</Text>
              </div>

              {/* Account Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                    <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <Text className="text-xs">{t('emailVerified')}</Text>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {user?.emailVerified ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {t('verified')}
                        </span>
                      ) : (
                        <span className="text-yellow-600 dark:text-yellow-400">
                          {t('notVerified')}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <Text className="text-xs">{t('createdAt')}</Text>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <Divider />
              <div className="flex gap-3">
                <Button
                  onClick={handleSaveProfile}
                  disabled={!hasChanges || isSaving}
                  className="flex-1"
                  size="lg"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? t('saving') : t('save')}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Password Card */}
        <Card decoration="top" decorationColor="violet">
          <div className="p-6 space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Key className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              {t('passwordSection')}
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-gray-500" />
                  {t('currentPasswordLabel')}
                </Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={isChangingPassword}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-gray-500" />
                  {t('newPasswordLabel')}
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isChangingPassword}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-gray-500" />
                  {t('confirmPasswordLabel')}
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isChangingPassword}
                />
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={
                  isChangingPassword || !currentPassword || !newPassword || !confirmPassword
                }
                className="w-full"
                size="lg"
              >
                <Key className="h-4 w-4 mr-2" />
                {isChangingPassword ? t('changingPassword') : t('changePassword')}
              </Button>
            </div>
          </div>
        </Card>

        {/* Notification Settings */}
        <NotificationSettings />

        {user?.email && <DeleteAccountCard email={user.email} />}
      </div>
    </div>
  );
}
