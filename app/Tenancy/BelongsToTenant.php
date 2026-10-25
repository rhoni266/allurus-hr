<?php

namespace App\Tenancy;

use Illuminate\Support\Str;

trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope);

        static::creating(function ($model) {
            $model->tenant_id ??= TenantContext::require();
            if (empty($model->{$model->getKeyName()}) && $model->getKeyType() === 'string') {
                $model->{$model->getKeyName()} = (string) Str::uuid7();
            }
        });
    }
}
