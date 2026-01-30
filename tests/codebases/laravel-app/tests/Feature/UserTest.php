<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserTest extends TestCase
{
    use RefreshDatabase;

    public function test_users_can_be_listed(): void
    {
        User::factory()->count(3)->create();

        $response = $this->get(route('users.index'));

        $response->assertStatus(200);
        $response->assertViewHas('users');
    }

    public function test_user_can_be_created(): void
    {
        $userData = [
            'name' => 'John Doe',
            'email' => 'john@example.com',
        ];

        $response = $this->post(route('users.store'), $userData);

        $response->assertRedirect();
        $this->assertDatabaseHas('users', $userData);
    }

    public function test_user_can_be_deleted(): void
    {
        $user = User::factory()->create();

        $response = $this->delete(route('users.destroy', $user));

        $response->assertRedirect();
        $this->assertDatabaseMissing('users', ['id' => $user->id]);
    }
}
