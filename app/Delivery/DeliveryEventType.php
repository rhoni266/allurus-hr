<?php

namespace App\Delivery;

enum DeliveryEventType: string
{
    case OrderCreated = 'order_created';
    case OrderCancelled = 'order_cancelled';
    case Ignore = 'ignore';
}
