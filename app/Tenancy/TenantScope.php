<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\{Builder, Model, Scope};

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        // Fail closed: no tenant context = no rows
        $tenantId = TenantContext::id();
        if ($tenantId === null) {
            $builder->whereRaw('1 = 0');
            return;
        }
        $builder->where($model->qualifyColumn('tenant_id'), $tenantId);
    }
}
